import express from "express";
import { google } from "googleapis";
import dotenv from "dotenv";
import { Readable } from "stream";

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
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive'
      ],
    });
    return google.sheets({ version: 'v4', auth });
  };

  const getDriveClient = async () => {
    let credentials;
    try {
      let key = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').trim();
      if (key.startsWith('"') && key.endsWith('"')) key = key.substring(1, key.length - 1);
      const tryParse = (str: string) => {
        try { return JSON.parse(str); } catch (e) {
          const firstBrace = str.indexOf('{');
          for (let i = str.indexOf('}', firstBrace); i !== -1; i = str.indexOf('}', i + 1)) {
            try { return JSON.parse(str.substring(firstBrace, i + 1)); } catch (inner) {}
          }
          throw e;
        }
      };
      credentials = tryParse(key);
      if (credentials && credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    } catch (e: any) { throw new Error(`Lỗi cấu hình Google Service Account: ${e.message}`); }
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
    });
    return google.drive({ version: 'v3', auth });
  };

  const PARENT_DRIVE_FOLDER_ID = "1BIWTK5I_UlgsYpvwo04ScmPqP6fIySHw";

  const saveImageToDrive = async (base64Image: string, id: string) => {
    try {
      const drive = await getDriveClient();
      const dateObj = new Date();
      const folderName = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
      
      // 1. Find or create daily folder
      let folderId = "";
      const folderSearch = await drive.files.list({
        q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and '${PARENT_DRIVE_FOLDER_ID}' in parents and trashed = false`,
        fields: 'files(id)',
      });

      if (folderSearch.data.files && folderSearch.data.files.length > 0) {
        folderId = folderSearch.data.files[0].id!;
      } else {
        const folderMetadata = {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [PARENT_DRIVE_FOLDER_ID],
        };
        const folder = await drive.files.create({
          requestBody: folderMetadata,
          fields: 'id',
        });
        folderId = folder.data.id!;
      }

      // 2. Upload image
      const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      
      const fileMetadata = {
        name: `${id}.jpg`,
        parents: [folderId],
      };
      const media = {
        mimeType: 'image/jpeg',
        body: Readable.from(buffer),
      };

      const file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, webViewLink',
      });

      // 3. Make file public (optional, but requested "link ảnh")
      await drive.permissions.create({
        fileId: file.data.id!,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });

      return file.data.webViewLink;
    } catch (error) {
      console.error("Error saving image to Drive:", error);
      return null;
    }
  };

  const cleanupOldDriveFolders = async () => {
    try {
      const drive = await getDriveClient();
      const response = await drive.files.list({
        q: `'${PARENT_DRIVE_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name, createdTime)',
      });

      const folders = response.data.files || [];
      const now = new Date();
      const threeDaysAgo = new Date(now.setDate(now.getDate() - 3));

      for (const folder of folders) {
        // Folder name is YYYY-MM-DD
        const folderDate = new Date(folder.name!);
        if (!isNaN(folderDate.getTime()) && folderDate < threeDaysAgo) {
          console.log(`Deleting old folder: ${folder.name} (${folder.id})`);
          await drive.files.delete({ fileId: folder.id! });
        }
      }
    } catch (error) {
      console.error("Error cleaning up old Drive folders:", error);
    }
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
        customerCode,
        customerName,
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
      const range = "D-App!A:L"; 

      console.log(`Attempting to save to Sheet ID: ${spreadsheetId}, Range: ${range}`);

      // 0. Save image to Drive and cleanup
      let driveImageUrl = null;
      if (imageUrl && imageUrl.startsWith('data:image')) {
        driveImageUrl = await saveImageToDrive(imageUrl, id);
        // Fire and forget cleanup
        cleanupOldDriveFolders().catch(err => console.error("Cleanup error:", err));
      }

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
        customerCode || '',
        customerName || '',
        location ? `${location.lat}, ${location.lng}` : 'N/A',
        location?.address || 'N/A',
        driveImageUrl || 'N/A'
      ]];

      let result;
      if (rowIndex !== -1) {
        // Update existing row (rowIndex is 0-based, but range is 1-based)
        const updateRange = `D-App!A${rowIndex + 1}:L${rowIndex + 1}`;
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

  // API Route to get customer name by customer code
  app.get("/api/get-customer-name/:customerCode", async (req, res) => {
    try {
      const { customerCode } = req.params;
      if (!customerCode) {
        return res.status(400).json({ error: "Missing customer code" });
      }

      if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        return res.status(500).json({ 
          error: "Hệ thống chưa được cấu hình Google Service Account Key."
        });
      }

      const spreadsheetId = process.env.GOOGLE_SHEETS_ID || "1ayrzQ3JTxuZuhXaxtoQN6jHS1T78sCHPhO2PDScJhhI";
      const sheets = await getSheetsClient();

      // Fetch columns R (Customer Code) and S (Customer Name)
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "D-App!R:S",
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        return res.json({ customerName: null });
      }

      // Search from bottom to top to get the most recent entry
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i][0] === customerCode && rows[i][1]) {
          return res.json({ customerName: rows[i][1] });
        }
      }

      res.json({ customerName: null });
    } catch (error: any) {
      console.error("Error fetching customer name:", error);
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
        range: "D-App!A:L",
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

        const [lat, lng] = (row[9] || '0, 0').split(',').map((s: string) => parseFloat(s.trim()));

        return {
          id: row[0],
          timestamp,
          vehicleType: row[3] === 'Xe tải' ? 'truck' : 'ship',
          idNumber: row[4],
          customerCode: row[5],
          customerName: row[6],
          volume: row[7],
          productType: row[8],
          location: {
            lat,
            lng,
            address: row[10]
          },
          driveImageUrl: row[11]
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
        message = `LỖI 403 (QUYỀN TRUY CẬP):
        - Ứng dụng đang dùng Email: ${serviceAccountEmail}
        - Ứng dụng đang tìm Sheet ID: ${spreadsheetIdUsed}
        
        HÃY KIỂM TRA:
        1. ID trên có khớp với ID trên trình duyệt của bạn không? (Nếu không, hãy cập nhật GOOGLE_SHEETS_ID trên Vercel).
        2. Bạn đã nhấn "Chia sẻ" và dán đúng Email trên vào chưa?
        3. Bạn đã bật "Google Drive API" chưa?`;
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
