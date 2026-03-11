import { GoogleSpreadsheet } from "google-spreadsheet";

export default async function handler(req, res) {
  try {

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_ID);

    await doc.useServiceAccountAuth(
      JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
    );

    await doc.loadInfo();

    const loginSheet = doc.sheetsByTitle["D-Login"];
    const dataSheet = doc.sheetsByTitle["D-App"];

    // -------------------------
    // LOGIN
    // -------------------------
    if (req.method === "POST" && req.body.action === "login") {

      const { id, password } = req.body;

      const rows = await loginSheet.getRows();

      const user = rows.find(
        (r) => r.get("ID") === id && r.get("Mật khẩu") === password
      );

      if (user) {
        return res.status(200).json({ success: true });
      }

      return res.status(401).json({ success: false, message: "Sai tài khoản" });
    }

    // -------------------------
    // LẤY DỮ LIỆU
    // -------------------------
    if (req.method === "GET") {

      const rows = await dataSheet.getRows();

      const data = rows.map((r) => ({
        maPhieu: r.get("Mã phiếu"),
        thoiGian: r.get("Ngày, Giờ"),
        loaiPT: r.get("Loại PT"),
        bienSo: r.get("Biển số"),
        khoiLuong: r.get("Khối lượng"),
        loaiHang: r.get("Loại hàng"),
        toaDo: r.get("Tọa độ"),
        viTri: r.get("Vị trí"),
      }));

      return res.status(200).json(data);
    }

    // -------------------------
    // GHI DỮ LIỆU
    // -------------------------
    if (req.method === "POST" && req.body.action === "add") {

      const {
        maPhieu,
        thoiGian,
        loaiPT,
        bienSo,
        khoiLuong,
        loaiHang,
        toaDo,
        viTri,
      } = req.body;

      await dataSheet.addRow({
        "Mã phiếu": maPhieu,
        "Ngày, Giờ": thoiGian,
        "Loại PT": loaiPT,
        "Biển số": bienSo,
        "Khối lượng": khoiLuong,
        "Loại hàng": loaiHang,
        "Tọa độ": toaDo,
        "Vị trí": viTri,
      });

      return res.status(200).json({ success: true });
    }

    res.status(400).json({ message: "Invalid request" });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Lỗi kết nối Google Sheet",
      error: error.message,
    });

  }
}