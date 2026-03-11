import express from "express";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// Google Sheets API Setup
const getSheetsClient = async () => {
    let credentials;
    try {
      let key = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').trim();
      
      // Handle cases where the key might be wrapped in quotes
      if (key.startsWith('"') && key.endsWith('"')) {
        key = key.substring(1, key.length - 1);
      } else if (key.startsWith("'") && key.endsWith("'")) {
        key = key.substring(1, key.length - 1);
      }

      if (!key) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is empty");
      }

      // Check if it looks like a URL instead of JSON
      if (key.startsWith('http')) {
        throw new Error("Bạn dường như đã dán một URL (đường dẫn) vào GOOGLE_SERVICE_ACCOUNT_KEY thay vì nội dung file JSON. Vui lòng mở file .json đã tải xuống từ Google Cloud, copy TOÀN BỘ nội dung (bắt đầu bằng { và kết thúc bằng }) và dán vào phần Secrets.");
      }

      // Robust parsing: try to find the first valid JSON object
      const tryParse = (str: string) => {
        try {
          return JSON.parse(str);
        } catch (e: any) {
          const firstBrace = str.indexOf('{');
          if (firstBrace === -1) {
            throw new Error(`Nội dung không phải là JSON hợp lệ. Chuỗi bắt đầu bằng: "${str.substring(0, 20)}...". File JSON của Google Service Account phải bắt đầu bằng dấu ngoặc nhọn {`);
          }
          
          // Search for the first valid JSON object by trying each closing brace
          for (let i = str.indexOf('}', firstBrace); i !== -1; i = str.indexOf('}', i + 1)) {
            try {
              const candidate = str.substring(firstBrace, i + 1);
              return JSON.parse(candidate);
            } catch (inner) {
              // Not this one, keep looking
            }
          }
          throw e;
        }
      };

      credentials = tryParse(key);

      // Fix for OpenSSL DECODER routines::unsupported error
      // Ensure private_key has real newlines instead of literal "\n" strings
      if (credentials && credentials.private_key) {
        credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
      }
    } catch (e: any) {
      console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:", e);
      throw new Error(`Lỗi cấu hình Google Service Account: ${e.message}`);
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
  };

  // API Route to check configuration
  app.get("/api/check-config", async (req, res) => {
    const results = {
      geminiKey: !!process.env.GEMINI_API_KEY,
      serviceAccountKey: {
        present: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
        validJson: false,
        isUrl: false,
        error: null as string | null
      },
      sheetsId: {
        present: !!process.env.GOOGLE_SHEETS_ID,
        value: process.env.GOOGLE_SHEETS_ID || "Sử dụng mặc định"
      }
    };

    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      try {
        const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY.trim();
        if (key.startsWith('http')) {
          results.serviceAccountKey.isUrl = true;
          results.serviceAccountKey.error = "Bạn đã dán một URL thay vì nội dung file JSON.";
        } else {
          JSON.parse(key);
          results.serviceAccountKey.validJson = true;
        }
      } catch (e: any) {
        results.serviceAccountKey.error = e.message;
      }
    }

    res.json(results);
  });

  // API Route to save to Google Sheets
  app.post("/api/save-to-sheet", async (req, res) => {
    try {
      const { 
        id, 
        timestamp, 
        vehicleType, 
        idNumber, 
        volume, 
        productType, 
        location,
        imageUrl 
      } = req.body;

      if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        return res.status(500).json({ 
          error: "Hệ thống chưa được cấu hình Google Service Account Key.",
          details: "Vui lòng thêm biến môi trường GOOGLE_SERVICE_ACCOUNT_KEY vào Vercel Settings > Environment Variables. Giá trị phải là toàn bộ nội dung file JSON của Service Account."
        });
      }

      const spreadsheetId = process.env.GOOGLE_SHEETS_ID || "1ayrzQ3JTxuZuhXaxtoQN6jHS1T78sCHPhO2PDScJhhI";
      const range = "D-App!A:I"; 

      console.log(`Attempting to save to Sheet ID: ${spreadsheetId}, Range: ${range}`);

      const sheets = await getSheetsClient();
      
      // 1. Check if record already exists
      const getResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "D-App!A:A", // Search in ID column
      });

      const rows = getResponse.data.values;
      let rowIndex = -1;
      if (rows && rows.length > 0) {
        rowIndex = rows.findIndex(row => row[0] === id);
      }

      const dateObj = new Date(timestamp);
      const day = String(dateObj.getDate()).padStart(2, '0');
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const year = String(dateObj.getFullYear()).slice(-2);
      const dateStr = `${day}/${month}/${year}`;
      
      const hours = String(dateObj.getHours()).padStart(2, '0');
      const minutes = String(dateObj.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;

      const values = [[
        id,
        dateStr,
        timeStr,
        vehicleType === 'truck' ? 'Xe tải' : 'Tàu thuyền',
        idNumber,
        volume,
        productType,
        location ? `${location.lat}, ${location.lng}` : 'N/A',
        location?.address || 'N/A'
      ]];

      let result;
      if (rowIndex !== -1) {
        // Update existing row (rowIndex is 0-based, but range is 1-based)
        const updateRange = `D-App!A${rowIndex + 1}:I${rowIndex + 1}`;
        const updateResponse = await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: updateRange,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values,
          },
        });
        result = { 
          updatedRange: updateResponse.data.updatedRange,
          isUpdate: true 
        };
      } else {
        // Append new row
        const appendResponse = await sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: {
            values,
          },
        });
        result = { 
          updatedRange: appendResponse.data.updates?.updatedRange,
          isUpdate: false 
        };
      }

      // Get spreadsheet metadata to confirm name
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId,
      });
      const sheetTitle = spreadsheet.data.properties?.title || "Bảng tính";

      res.json({ 
        success: true, 
        updatedRange: result.updatedRange,
        isUpdate: result.isUpdate,
        sheetTitle,
        isDefault: !process.env.GOOGLE_SHEETS_ID
      });
    } catch (error: any) {
      console.error("Error saving to Google Sheets:", error);
      let message = error.message;
      
      // Extract service account email for the error message
      let serviceAccountEmail = "Service Account email";
      try {
        const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '';
        const credentials = JSON.parse(key.startsWith('{') ? key : key.substring(key.indexOf('{')));
        serviceAccountEmail = credentials.client_email || serviceAccountEmail;
      } catch (e) {}

      if (error.code === 404) {
        message = `Không tìm thấy Spreadsheet ID: ${process.env.GOOGLE_SHEETS_ID}. Vui lòng kiểm tra lại ID trong phần Secrets.`;
      } else if (error.message?.includes('Requested entity was not found')) {
        message = `Không tìm thấy tab "D-App" trong Google Sheet. Vui lòng tạo tab tên "D-App" hoặc kiểm tra lại Spreadsheet ID.`;
      } else if (error.code === 403) {
        message = `Lỗi quyền truy cập (403). Hãy đảm bảo bạn đã chia sẻ Google Sheet với email: ${serviceAccountEmail} với quyền "Người chỉnh sửa" (Editor).`;
      }
      res.status(500).json({ error: message });
    }
  });

  // API Route to get vehicle volume by ID number
  app.get("/api/get-vehicle-volume/:idNumber", async (req, res) => {
    try {
      const { idNumber } = req.params;
      if (!idNumber) {
        return res.status(400).json({ error: "Missing ID number" });
      }

      if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        return res.status(500).json({ 
          error: "Hệ thống chưa được cấu hình Google Service Account Key.",
          details: "Vui lòng thêm biến môi trường GOOGLE_SERVICE_ACCOUNT_KEY vào Vercel Settings > Environment Variables. Giá trị phải là toàn bộ nội dung file JSON của Service Account."
        });
      }

      const spreadsheetId = process.env.GOOGLE_SHEETS_ID || "1ayrzQ3JTxuZuhXaxtoQN6jHS1T78sCHPhO2PDScJhhI";
      const sheets = await getSheetsClient();

      // Fetch columns E (ID Number) and F (Volume)
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "D-App!E:F",
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.json({ volume: null });
      }

      // Search from bottom to top to get the most recent entry
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i][0] === idNumber && rows[i][1]) {
          return res.json({ volume: rows[i][1] });
        }
      }

      res.json({ volume: null });
    } catch (error: any) {
      console.error("Error fetching vehicle volume:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to delete from Google Sheets
  app.post("/api/delete-from-sheet", async (req, res) => {
    try {
      const { id } = req.body;

      if (!id) {
        return res.status(400).json({ error: "Missing record ID" });
      }

      if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        return res.status(500).json({ 
          error: "Hệ thống chưa được cấu hình Google Service Account Key.",
          details: "Vui lòng thêm biến môi trường GOOGLE_SERVICE_ACCOUNT_KEY vào Vercel Settings > Environment Variables. Giá trị phải là toàn bộ nội dung file JSON của Service Account."
        });
      }

      const spreadsheetId = process.env.GOOGLE_SHEETS_ID || "1ayrzQ3JTxuZuhXaxtoQN6jHS1T78sCHPhO2PDScJhhI";
      const sheets = await getSheetsClient();

      // 1. Find the row index
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "D-App!A:A", // Search in ID column
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: "No data found in sheet" });
      }

      const rowIndex = rows.findIndex(row => row[0] === id);
      if (rowIndex === -1) {
        return res.status(404).json({ error: "Record not found in Google Sheet" });
      }

      // 2. Get the sheet ID for the specific tab "D-App"
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId,
      });
      const sheet = spreadsheet.data.sheets?.find(s => s.properties?.title === "D-App");
      
      if (!sheet || sheet.properties?.sheetId === undefined) {
        return res.status(404).json({ error: "Tab 'D-App' not found" });
      }

      const sheetId = sheet.properties.sheetId;

      // 3. Delete the row
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: sheetId,
                  dimension: "ROWS",
                  startIndex: rowIndex,
                  endIndex: rowIndex + 1,
                },
              },
            },
          ],
        },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting from Google Sheets:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to fetch all history from Google Sheets
  app.get("/api/get-history", async (req, res) => {
    try {
      if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        return res.status(500).json({ 
          error: "Hệ thống chưa được cấu hình Google Service Account Key.",
          details: "Vui lòng thêm biến môi trường GOOGLE_SERVICE_ACCOUNT_KEY vào Vercel Settings > Environment Variables. Giá trị phải là toàn bộ nội dung file JSON của Service Account."
        });
      }

      const spreadsheetId = process.env.GOOGLE_SHEETS_ID || "1ayrzQ3JTxuZuhXaxtoQN6jHS1T78sCHPhO2PDScJhhI";
      const sheets = await getSheetsClient();

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "D-App!A:I",
      });

      const rows = response.data.values;
      if (!rows || rows.length <= 1) {
        return res.json({ history: [] });
      }

      // Assuming first row is header
      const history = rows.slice(1).map(row => {
        // Parse date and time back to timestamp
        const [day, month, year] = row[1].split('/');
        const [hours, minutes] = row[2].split(':');
        const fullYear = `20${year}`;
        const timestamp = new Date(
          parseInt(fullYear), 
          parseInt(month) - 1, 
          parseInt(day), 
          parseInt(hours), 
          parseInt(minutes)
        ).toISOString();

        const [lat, lng] = (row[7] || '0, 0').split(',').map((s: string) => parseFloat(s.trim()));

        return {
          id: row[0],
          timestamp,
          vehicleType: row[3] === 'Xe tải' ? 'truck' : 'ship',
          idNumber: row[4],
          volume: row[5],
          productType: row[6],
          location: {
            lat,
            lng,
            address: row[8]
          }
        };
      });

      res.json({ history });
    } catch (error: any) {
      console.error("Error fetching history from Google Sheets:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route for Login
  app.post("/api/login", async (req, res) => {
    try {
      const { id, password } = req.body;

      if (!id || !password) {
        return res.status(400).json({ error: "Vui lòng nhập đầy đủ ID và Mật khẩu" });
      }

      if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        return res.status(500).json({ 
          error: "Hệ thống chưa được cấu hình Google Service Account Key.",
          details: "Vui lòng thêm biến môi trường GOOGLE_SERVICE_ACCOUNT_KEY vào Vercel Settings > Environment Variables. Giá trị phải là toàn bộ nội dung file JSON của Service Account."
        });
      }

      const spreadsheetId = process.env.GOOGLE_SHEETS_ID || "1ayrzQ3JTxuZuhXaxtoQN6jHS1T78sCHPhO2PDScJhhI";
      const sheets = await getSheetsClient();

      // Check if D-Login sheet exists, if not create it
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const loginSheet = spreadsheet.data.sheets?.find(s => s.properties?.title === "D-Login");

      if (!loginSheet) {
        // Create the sheet
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{
              addSheet: {
                properties: { title: "D-Login" }
              }
            }]
          }
        });

        // Add headers
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: "D-Login!A1:C1",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [["TT", "ID", "Mật khẩu"]]
          }
        });

        return res.status(401).json({ 
          error: "Đã tạo tab 'D-Login'. Vui lòng thêm tài khoản vào sheet trước khi đăng nhập." 
        });
      }

      // Fetch columns B (ID) and C (Mật khẩu) from D-Login tab
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "D-Login!B:C",
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.status(401).json({ error: "Không tìm thấy dữ liệu tài khoản. Vui lòng kiểm tra sheet D-Login." });
      }

      // Find user with matching ID and password
      // Skip header row if it exists (assuming first row is header if it contains "ID")
      const startIndex = rows[0][0] === "ID" ? 1 : 0;
      
      // Trim values to avoid issues with accidental spaces in Google Sheets
      const user = rows.slice(startIndex).find(row => {
        const sheetId = (row[0] || "").toString().trim();
        const sheetPass = (row[1] || "").toString().trim();
        return sheetId === id.trim() && sheetPass === password.trim();
      });

      if (user) {
        res.json({ success: true, userId: id });
      } else {
        res.status(401).json({ error: "ID hoặc Mật khẩu không chính xác. Vui lòng kiểm tra lại dữ liệu trong tab 'D-Login'." });
      }
    } catch (error: any) {
      console.error("Error during login:", error);
      let message = error.message;
      
      // Extract service account email for the error message
      let serviceAccountEmail = "Service Account email";
      try {
        const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '';
        const credentials = JSON.parse(key.startsWith('{') ? key : key.substring(key.indexOf('{')));
        serviceAccountEmail = credentials.client_email || serviceAccountEmail;
      } catch (e) {}

      const spreadsheetIdUsed = process.env.GOOGLE_SHEETS_ID || "1ayrzQ3JTxuZuhXaxtoQN6jHS1T78sCHPhO2PDScJhhI";
      
      if (error.code === 404) {
        message = `Không tìm thấy Spreadsheet ID: ${spreadsheetIdUsed}. Hãy đảm bảo bạn đã nhập đúng ID trong Vercel Environment Variables.`;
      } else if (error.message?.includes('Requested entity was not found')) {
        message = `Không tìm thấy tab "D-Login" trong Google Sheet (ID: ${spreadsheetIdUsed}). Vui lòng tạo tab tên "D-Login" với các cột: TT, ID, Mật khẩu.`;
      } else if (error.code === 403) {
        message = `Lỗi quyền truy cập (403) cho Sheet ID: ${spreadsheetIdUsed}. Chi tiết: ${error.message}. Hãy đảm bảo bạn đã: 1. Chia sẻ Sheet cho email ${serviceAccountEmail} (Editor). 2. Bật Google Sheets API tại Google Cloud Console.`;
      }
      res.status(500).json({ error: message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  if (process.env.NODE_ENV !== "production") {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

export default app;
