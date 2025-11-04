// server/server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const formidable = require('formidable');
const sgMail = require('@sendgrid/mail');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 3000;

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

function getMpesaEnvBase() {
    return (process.env.MPESA_ENV === 'production') ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
}

async function getMpesaToken() {
    const key = process.env.MPESA_CONSUMER_KEY;
    const secret = process.env.MPESA_CONSUMER_SECRET;
    const base = getMpesaEnvBase();
    const url = `${base}/oauth/v1/generate?grant_type=client_credentials`;
    const auth = Buffer.from(`${key}:${secret}`).toString('base64');
    const r = await axios.get(url, { headers: { Authorization: `Basic ${auth}` } });
    return r.data.access_token;
}

function getTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

app.post('/mpesa-initiate', async(req, res) => {
    try {
        const { amount, accountReference, phone } = req.body;
        if (!amount || !phone) return res.status(400).json({ message: 'amount and phone required' });
        const token = await getMpesaToken();
        const base = getMpesaEnvBase();
        const url = `${base}/mpesa/stkpush/v1/processrequest`;
        const timestamp = getTimestamp();
        const passkey = process.env.MPESA_PASSKEY;
        const shortcode = process.env.MPESA_SHORTCODE;
        const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');
        const payload = {
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: amount,
            PartyA: phone,
            PartyB: shortcode,
            PhoneNumber: phone,
            CallBackURL: process.env.MPESA_CALLBACK_URL,
            AccountReference: accountReference || 'VYG',
            TransactionDesc: 'VYG Payment'
        };
        const r = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` } });
        return res.json({ ok: true, data: r.data });
    } catch (err) {
        console.error(err.response ? .data || err.message);
        return res.status(500).json({ message: err.response ? .data || err.message });
    }
});

// file upload endpoint: saves to /uploads and returns url
app.post('/upload', (req, res) => {
    const form = new formidable.IncomingForm({ multiples: false, uploadDir: path.join(__dirname, 'uploads'), keepExtensions: true });
    form.parse(req, (err, fields, files) => {
        if (err) return res.status(500).json({ message: err.message || 'upload error' });
        const fileKey = Object.keys(files)[0];
        const file = files[fileKey];
        const url = `${process.env.STORAGE_BASE_URL || req.protocol + '://' + req.get('host')}/uploads/${path.basename(file.path)}`;
        return res.json({ ok: true, url });
    });
});

// serve uploads publicly (for demo). In production use S3 or secure storage.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// generate-pdf: accepts multipart/form-data (files + form JSON) or JSON
app.post('/generate-pdf', (req, res) => {
    const form = new formidable.IncomingForm({ multiples: false, uploadDir: path.join(__dirname, 'uploads'), keepExtensions: true });
    form.parse(req, async(err, fields, files) => {
        try {
            if (err) return res.status(500).json({ message: err.message || 'parse error' });

            const product = fields.product || 'Application';
            const applicationId = fields.applicationId || ('app-' + Date.now());
            const email = fields.email;
            const formData = fields.form ? JSON.parse(fields.form) : (fields.formData ? JSON.parse(fields.formData) : fields);

            // generate HTML path for template
            const templateName = (product.toLowerCase().includes('emergency')) ? 'emergency' :
                (product.toLowerCase().includes('development')) ? 'development' : 'generic';
            const templatePath = path.join(__dirname, 'templates', `${templateName}.html`);
            const tempHtml = fs.readFileSync(templatePath, 'utf8');

            // substitute placeholders in template with formData
            let html = tempHtml.replace(/{{applicationId}}/g, applicationId).replace(/{{product}}/g, product);
            for (const k in formData) { html = html.replace(new RegExp(`{{${k}}}`, 'g'), (formData[k] || '')); }

            // if files exist, include their names in html
            let attachments = [];
            ['idFile', 'kraFile', 'guarantorFile'].forEach(key => {
                if (files[key]) attachments.push({ path: files[key].path, name: files[key].name });
            });

            // launch puppeteer and render pdf
            const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });
            const pdfPath = path.join(__dirname, 'generated', `${product.replace(/\s+/g,'_')}_${Date.now()}.pdf`);
            if (!fs.existsSync(path.dirname(pdfPath))) fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
            await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm' } });
            await browser.close();

            const url = `${process.env.STORAGE_BASE_URL || (req.protocol + '://' + req.get('host'))}/generated/${path.basename(pdfPath)}`;
            // save pdf to generated folder and serve
            // send email if requested
            if (email && process.env.SENDGRID_API_KEY) {
                const msg = {
                    to: email,
                    from: process.env.SENDGRID_FROM,
                    subject: `${product} - Visionary Youth Group`,
                    text: `Attached is your ${product} PDF.`,
                    html: `<p>Attached is your <b>${product}</b> PDF.</p>`,
                    attachments: [{
                        content: fs.readFileSync(pdfPath).toString('base64'),
                        filename: path.basename(pdfPath),
                        type: 'application/pdf',
                        disposition: 'attachment'
                    }]
                };
                try { await sgMail.send(msg); } catch (e) { console.warn('SendGrid error', e.message || e); }
            }

            return res.json({ ok: true, url, filename: path.basename(pdfPath) });
        } catch (err) {
            console.error('generate-pdf', err);
            return res.status(500).json({ message: err.message || 'pdf error' });
        }
    });
});

// serve generated pdfs
app.use('/generated', express.static(path.join(__dirname, 'generated')));

// generate-statement: generate PDF statement for a member by uid using a simple template
app.post('/generate-statement', async(req, res) => {
    try {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ message: 'uid required' });
        // For demo, create a simple HTML that lists transactions from RTDB using Firebase Admin is ideal.
        // Because server doesn't have Firebase Admin set up here, we'll expect client to call /generate-pdf with form that contains transaction rows.
        // For now return 400 instructing client to call generate-pdf with formData.
        return res.status(400).json({ message: 'Server-side statement generation requires transaction data. Use /generate-pdf with statement template.' });
    } catch (err) {
        return res.status(500).json({ message: err.message || 'error' });
    }
});

// mpesa callback
app.post('/mpesa-callback', (req, res) => {
    console.log('MPESA callback', JSON.stringify(req.body).substring(0, 2000));
    // TODO: Update your database with payment confirmation
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

app.listen(PORT, () => console.log(`VYG server running on port ${PORT}`));