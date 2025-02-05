const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const path = require("path");
const AdmZip = require("adm-zip");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const DOWNLOAD_DIR = path.join(__dirname, "downloads");

fs.ensureDirSync(DOWNLOAD_DIR);

app.use(express.static("public"));
app.use(express.json());

app.get("/fetch-files", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        const files = [];

        const formatFileSize = (bytes) => {
            if (bytes < 1024) return `${bytes} B`;
            else if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
            else if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
            else return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        };

        const getFileSize = async (fileUrl) => {
            try {
                const response = await axios.head(fileUrl);
                const size = response.headers["content-length"];
                return size ? formatFileSize(parseInt(size)) : "Unknown";
            } catch {
                return "Unknown";
            }
        };

        const filePromises = $("a[href]").map(async (_, el) => {
            const link = $(el).attr("href");
            const ext = path.extname(link).substring(1);
            if (ext) {
                const fileUrl = new URL(link, url).href;
                const size = await getFileSize(fileUrl);
                files.push({
                    name: path.basename(link),
                    link: fileUrl,
                    ext,
                    size
                });
            }
        }).get();

        await Promise.all(filePromises);

        res.json(files);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch files" });
    }
});


app.post("/download", async (req, res) => {
    const { files } = req.body;
    if (!files || files.length === 0) return res.status(400).json({ error: "No files selected" });

    const zip = new AdmZip();
    const zipName = `files_${Date.now()}.zip`;
    const zipPath = path.join(DOWNLOAD_DIR, zipName);

    let totalSizeBytes = 0;

    // Get total file size
    for (const fileUrl of files) {
        try {
            const response = await axios.head(fileUrl);
            totalSizeBytes += parseInt(response.headers["content-length"] || 0);
        } catch (err) {
            console.error("Error getting file size:", fileUrl);
        }
    }
    const formatFileSize = (bytes) => {
        if (bytes < 1024) return `${bytes} B`;
        else if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        else if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        else return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };
    const totalSizeFormatted = formatFileSize(totalSizeBytes);
    io.emit("downloadMessage", { message: `Downloading total ${totalSizeFormatted}...` });

    let completed = 0;
    const total = files.length;

    for (const fileUrl of files) {
        try {
            const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
            const filename = path.basename(fileUrl);
            const filePath = path.join(DOWNLOAD_DIR, filename);
            fs.writeFileSync(filePath, response.data);
            zip.addLocalFile(filePath);

            completed++;
            const progress = ((completed / total) * 100).toFixed(2);
            io.emit("progressUpdate", { progress });
            console.log(`Progress: ${progress}%`);
        } catch (err) {
            console.error("Error downloading:", fileUrl);
        }
    }

    zip.writeZip(zipPath);
    io.emit("downloadMessage", { message: `Files downloaded, stored in ${zipPath}` });

    res.json({ zipPath });
});


app.get("/download-zip", (req, res) => {
    const { path: zipPath } = req.query;
    res.download(zipPath);
});

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
