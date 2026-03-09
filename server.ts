import express from "express";
import { createServer as createViteServer } from "vite";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
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
        return res.status(500).json({ error: "GOOGLE_SERVICE_ACCOUNT_KEY not configured" });
      }

      const spreadsheetId = process.env.GOOGLE_SHEETS_ID || "1ayrzQ3JTxuZuhXaxtoQN6jHS1T78sCHPhO2PDScJhhI";
      const range = "D-App!A:H"; 

      console.log(`Attempting to save to Sheet ID: ${spreadsheetId}, Range: ${range}`);

      const sheets = await getSheetsClient();
      
      // Get spreadsheet metadata to confirm name
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId,
      });
      const sheetTitle = spreadsheet.data.properties?.title || "Bảng tính";

      const values = [[
        id,
        new Date(timestamp).toLocaleString('vi-VN'),
        vehicleType === 'truck' ? 'Xe tải' : 'Tàu thuyền',
        idNumber,
        volume,
        productType,
        location ? `${location.lat}, ${location.lng}` : 'N/A',
        location?.address || 'N/A'
      ]];

      const response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values,
        },
      });

      console.log("Google Sheets append response:", response.data);

      res.json({ 
        success: true, 
        updatedRange: response.data.updates?.updatedRange,
        sheetTitle,
        isDefault: !process.env.GOOGLE_SHEETS_ID
      });
    } catch (error: any) {
      console.error("Error saving to Google Sheets:", error);
      let message = error.message;
      if (error.code === 404) {
        message = `Không tìm thấy Spreadsheet ID: ${process.env.GOOGLE_SHEETS_ID}. Vui lòng kiểm tra lại ID trong phần Secrets.`;
      } else if (error.message?.includes('Requested entity was not found')) {
        message = `Không tìm thấy tab "D-App" trong Google Sheet. Vui lòng tạo tab tên "D-App" hoặc kiểm tra lại Spreadsheet ID.`;
      } else if (error.code === 403) {
        message = `Lỗi quyền truy cập (403). Hãy đảm bảo bạn đã chia sẻ Google Sheet với email của Service Account (email kết thúc bằng .iam.gserviceaccount.com) với quyền "Người chỉnh sửa" (Editor).`;
      }
      res.status(500).json({ error: message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
