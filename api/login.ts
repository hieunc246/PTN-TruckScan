import type { NextApiRequest, NextApiResponse } from 'next';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import fs from 'fs';
import path from 'path';

const KEY_PATH = path.join(process.cwd(), 'google-key.json');
const SHEET_ID = '1GvTR_EWGYEmRVC2pKfI4ota-Uzm4E5ufJy-WddupZ48';
const SHEET_TITLE = 'D-Login';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { id, password } = req.body;

    const doc = new GoogleSpreadsheet(SHEET_ID);
    const creds = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();

    const sheet = doc.sheetsByTitle[SHEET_TITLE];
    const rows = await sheet.getRows();

    const user = rows.find(r => r.ID === id && r['Mật khẩu'] === password);

    if (user) res.status(200).json({ success: true, message: 'Login successful' });
    else res.status(401).json({ success: false, message: 'Invalid credentials' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error', error });
  }
}