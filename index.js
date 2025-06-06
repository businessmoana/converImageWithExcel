require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

const { Worker } = require('worker_threads');
const xlsx = require('xlsx');

const path = require('path');
const fs = require('fs').promises;
const fs2 = require('fs');

// Number of concurrent workers
const NUM_WORKERS = 4;
const PORT = 3000;


const getTimeStamp = () => {
    const now = new Date();
    return now.toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
};
const excelDir = './excel_files';
if (!fs2.existsSync(excelDir)) {
    fs2.mkdirSync(excelDir);
}

const convertedDirMain = `./converted_images`;
if (!fs2.existsSync(convertedDirMain)) {
    fs2.mkdirSync(convertedDirMain);
}

const convertedDir = `./converted_images/${getTimeStamp()}`;
if (!fs2.existsSync(convertedDir)) {
    fs2.mkdirSync(convertedDir);
}

const imagesDir = `./images`;
if (!fs2.existsSync(imagesDir)) {
    fs2.mkdirSync(imagesDir);
}

async function processImages() {
    try {
        // Read the existing Excel file
        const excelFiles = await fs.readdir(excelDir);
        const latestExcelFile = excelFiles
            .filter(file => file.endsWith('.xlsx'))
            .sort()
            .pop();

        if (!latestExcelFile) {
            console.error('No Excel file found in the excel_files directory');
            return;
        }

        const excelPath = path.join(excelDir, latestExcelFile);
        const workbook = xlsx.readFile(excelPath);
        const worksheet = workbook.Sheets['Results'];
        const excelData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

        // Skip header row
        const imageData = excelData.slice(1).map(row => ({
            imageName: row[0],
            detectedText: row[1],
            translatedText: row[2]
        }));

        console.log(`Found ${imageData.length} images to process from Excel file`);

        // Create a queue of images to process
        const queue = imageData.map(data => ({
            imagePath: path.join(imagesDir, data.imageName),
            imageName: data.imageName,
            translatedText: data.translatedText,
            excelPath,
            convertedDir
        }));

        // Process images using worker threads
        const workers = new Set();
        const results = [];

        while (queue.length > 0 || workers.size > 0) {
            // Fill up workers until we reach the limit or run out of images
            while (workers.size < NUM_WORKERS && queue.length > 0) {
                const imageData = queue.shift();
                const worker = new Worker(path.join(__dirname, 'workers', 'imageWorker.js'));

                worker.on('message', (result) => {
                    if (result.success) {
                        console.log(`Successfully processed ${path.basename(result.outputPath)}`);
                    } else {
                        console.error(`Error processing ${path.basename(imageData.imagePath)}: ${result.error}`);
                    }
                    results.push(result);
                    workers.delete(worker);
                    worker.terminate();
                });

                worker.on('error', (error) => {
                    console.error(`Worker error for ${path.basename(imageData.imagePath)}: ${error}`);
                    workers.delete(worker);
                    worker.terminate();
                });

                worker.postMessage(imageData);
                workers.add(worker);
                console.log(`Started processing ${path.basename(imageData.imagePath)}`);
            }

            // Wait a bit before checking again
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Log final results
        console.log('\nProcessing complete!');
        console.log(`Successfully processed ${results.filter(r => r.success).length} images`);
        console.log(`Failed to process ${results.filter(r => !r.success).length} images`);

    } catch (error) {
        console.error('Error processing images:', error);
    }
}


app.listen(PORT, async () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    await processImages();
});