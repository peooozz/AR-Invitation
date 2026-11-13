import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, '../public/qr.png');

// Get URL from command line or default to Vercel production domain
const targetUrl = process.argv[2] || process.env.VERCEL_URL || 'https://swarajya-forts-ar.vercel.app';

async function generateQRCode() {
  console.log(`📱 Generating Royal QR Code for: ${targetUrl}`);
  
  await QRCode.toFile(outputPath, targetUrl, {
    width: 600,
    margin: 2,
    color: {
      dark: '#8A6A1E', // Royal deep gold
      light: '#FFFDF7', // Ivory background
    },
    errorCorrectionLevel: 'H',
  });

  console.log(`✅ QR Code saved to: public/qr.png`);
}

generateQRCode().catch(console.error);

