import type { NextApiRequest, NextApiResponse } from 'next';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import fs from 'fs';
import path from 'path';

const KEY_PATH = path.join(process.cwd(), 'google-key.json');
const SHEET_ID = '1GvTR_EWGYEmRVC2pKfI4ota-Uzm4E5ufJy-WddupZ48';
const SHEET_TITLE = 'D-app';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const doc = new GoogleSpreadsheet(SHEET_ID);
    const creds = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();

    const sheet = doc.sheetsByTitle[SHEET_TITLE];

    const { maPhieu, ngay, gio, loaiPT, bienSo, khoiLuong, loaiHang, toaDo, viTri } = req.body;

    await sheet.addRow({
      'Mã phiếu': maPhieu,
      Ngày: ngay,
      Giờ: gio,
      'Loại PT': loaiPT,
      'Biển số': bienSo,
      Khối lượng: khoiLuong,
      'Loại hàng': loaiHang,
      Tọa độ: toaDo,
      Vị trí: viTri
    });

    res.status(200).json({ message: 'Saved successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error saving data', error });
  }
}