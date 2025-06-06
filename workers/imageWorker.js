const { parentPort } = require('worker_threads');
const { OpenAI } = require('openai');
const { toFile } = require('openai')
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const promptsDir = path.join('./prompts');

function loadPrompt(promptName) {
    const promptPath = path.join(promptsDir, `${promptName}.txt`);
    try {
        const promptContent = fs.readFileSync(promptPath, 'utf-8');
        return promptContent;
    } catch (err) {
        console.error(`Error loading prompt ${promptName}:`, err.message);
        throw err;
    }
}

async function translateImageName(imageName) {
    try {
        const prompt = `You are an expert translator tasked with translating file names from Slovenian to SLOVAKIAN.

        Instructions:

        Translate only words from Slovenian to SLOVAKIAN.

        Preserve the original filename structure including:

        Underscores (_)

        Hyphens (-)

        Numbers (e.g., 01, 02, 123)

        File extensions (.png, .jpg, .jpeg, etc.)

        Do not add spaces where they do not exist.

        Do not alter casing (uppercase, lowercase should remain as in the original).

        If the filename has no separators (no spaces, underscores, or hyphens), carefully translate it without inserting any separators.

        Translate accurately, contextually appropriate, and naturally.                                                
        translate this : ${imageName}
        `;

        const response = await openai.chat.completions.create({
            model: "gpt-4.5-preview",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error('Translation error:', error);
        throw error;
    }
}

async function generateImage(translatedText, originalImagePath) {
    try {
        // Read the original image
        const image = await toFile(fs.createReadStream(originalImagePath), null, {
            type: "image/png",
        })
        const promptContent = loadPrompt('generate_image_prompt');
        const prompt = promptContent.replace('[TEXT]', translatedText);;
        const response = await openai.images.edit({
            model: "gpt-image-1",
            image: image,
            prompt: prompt,
        });
        const image_base64 = response.data[0].b64_json;
        console.log("response=>", response);
        const image_bytes = Buffer.from(image_base64, "base64");
        return image_bytes;
    } catch (error) {
        console.error('Image generation error:', error);
        throw error;
    }
}


function ensurePngExtension(filename) {
    // Get the file extension
    const ext = path.extname(filename).toLowerCase();

    // If there's no extension or it's not .png, add .png
    if (!ext || ext !== '.png') {
        // Remove any existing extension and add .png
        const basename = path.basename(filename, ext); // Removes existing extension
        filename = `${basename}.png`;
    }

    return filename;
}

parentPort.on('message', async (data) => {
    console.log("here worker")
    try {
        const { imagePath, imageName, translatedText, excelPath, convertedDir } = data;
        
        // Generate new image using the translated text
        const buffer = await generateImage(translatedText, imagePath);
        
        // Create translated image name
        let translatedImageName = await translateImageName(imageName);
        translatedImageName = ensurePngExtension(translatedImageName);
        
        // Save the generated image
        const outputPath = path.join(convertedDir, path.basename(translatedImageName));
        fs.writeFileSync(outputPath, buffer);

        // Read the original Excel file
        const workbook = xlsx.readFile(excelPath);
        let worksheet = workbook.Sheets['Results'];
        const existingData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
        
        // Find the row with matching image name and update it
        const rowIndex = existingData.findIndex(row => row[0] === imageName);
        if (rowIndex !== -1) {
            existingData[rowIndex][3] = translatedImageName; // Add converted image name
        }

        // Create a new workbook for the results
        const resultWorkbook = xlsx.utils.book_new();
        const resultWorksheet = xlsx.utils.aoa_to_sheet(existingData);
        
        // Add headers if they don't exist
        if (!existingData[0] || existingData[0].length < 4) {
            const headers = ['Image Name', 'Detected Text', 'Translated Text', 'Converted Image Name'];
            xlsx.utils.sheet_add_aoa(resultWorksheet, [headers], { origin: 'A1' });
        }

        // Add the worksheet to the workbook
        xlsx.utils.book_append_sheet(resultWorkbook, resultWorksheet, 'Results');

        // Create results directory if it doesn't exist
        const resultsDir = path.join(__dirname, '..', 'results');
        if (!fs.existsSync(resultsDir)) {
            fs.mkdirSync(resultsDir);
        }

        // Save the new Excel file in the results folder
        const resultExcelPath = path.join(resultsDir, `updated_results_${path.basename(excelPath)}`);
        xlsx.writeFile(resultWorkbook, resultExcelPath);

        parentPort.postMessage({
            success: true,
            outputPath,
            resultExcelPath
        });
    } catch (error) {
        parentPort.postMessage({
            success: false,
            error: error.message
        });
    }
}); 