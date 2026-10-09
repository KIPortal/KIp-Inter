const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

let multer = null;
try {
    multer = require('multer');
} catch (_) {
    multer = null;
}

let upload;

if (multer) {
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }
            cb(null, uploadsDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            const baseName = path.basename(file.originalname || 'archivo');
            const safeName = baseName.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/^\.+/, '') || 'archivo';
            cb(null, `${uniqueSuffix}-${safeName}`);
        }
    });

    upload = multer({
        storage,
        limits: {
            fileSize: 25 * 1024 * 1024,
            files: 10
        }
    });
} else {
    // Fallback multipart/form-data parser in pure Node.js if multer is pending installation
    const parseMultipartMiddleware = (req, res, next) => {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/form-data')) {
            return next();
        }

        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (!boundaryMatch) {
            return next();
        }
        const boundary = boundaryMatch[1] || boundaryMatch[2];
        const chunks = [];

        req.on('data', chunk => {
            chunks.push(chunk);
        });

        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            req.body = req.body || {};
            req.files = req.files || [];

            const boundaryBuffer = Buffer.from('--' + boundary);
            let start = 0;

            while (start < buffer.length) {
                const idx = buffer.indexOf(boundaryBuffer, start);
                if (idx === -1) break;

                const partStart = idx + boundaryBuffer.length;
                let nextIdx = buffer.indexOf(boundaryBuffer, partStart);
                if (nextIdx === -1) {
                    nextIdx = buffer.length;
                }

                const part = buffer.slice(partStart, nextIdx);
                start = nextIdx;

                const headerEnd = part.indexOf('\r\n\r\n');
                if (headerEnd === -1) continue;

                const headerStr = part.slice(0, headerEnd).toString('utf-8');
                let bodyPart = part.slice(headerEnd + 4);

                // Strip trailing \r\n
                if (bodyPart.length >= 2 && bodyPart[bodyPart.length - 2] === 13 && bodyPart[bodyPart.length - 1] === 10) {
                    bodyPart = bodyPart.slice(0, bodyPart.length - 2);
                }

                const nameMatch = headerStr.match(/name="([^"]+)"/);
                const filenameMatch = headerStr.match(/filename="([^"]+)"/);
                const contentTypeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

                if (!nameMatch) continue;
                const fieldName = nameMatch[1];

                if (filenameMatch && filenameMatch[1]) {
                    if (!fs.existsSync(uploadsDir)) {
                        fs.mkdirSync(uploadsDir, { recursive: true });
                    }
                    const originalName = filenameMatch[1];
                    const baseName = path.basename(originalName);
                    const safeName = baseName.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/^\.+/, '') || 'archivo';
                    const uniqueFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`;
                    const targetPath = path.join(uploadsDir, uniqueFilename);

                    fs.writeFileSync(targetPath, bodyPart);

                    req.files.push({
                        fieldname: fieldName,
                        originalname: originalName,
                        filename: uniqueFilename,
                        path: targetPath,
                        size: bodyPart.length,
                        mimetype: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream'
                    });
                } else {
                    const val = bodyPart.toString('utf-8');
                    req.body[fieldName] = val;
                }
            }

            next();
        });

        req.on('error', err => {
            next(err);
        });
    };

    upload = {
        any: () => parseMultipartMiddleware,
        array: () => parseMultipartMiddleware,
        single: () => parseMultipartMiddleware,
        fields: () => parseMultipartMiddleware
    };
}

module.exports = upload;
