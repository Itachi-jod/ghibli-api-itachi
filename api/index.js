const axios = require("axios");
const FormData = require("form-data");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const BASE_URL = "https://abidlabs-easyghibli.hf.space";

function generateRandomId(length = 11) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join("");
}

async function uploadImageFromUrl(imageUrl) {
  const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const tmpFilePath = path.join("/tmp", `${uuidv4()}.jpg`); // ✅ use /tmp for vercel
  fs.writeFileSync(tmpFilePath, Buffer.from(response.data));

  const uploadId = generateRandomId();
  const uploadUrl = `${BASE_URL}/gradio_api/upload?upload_id=${uploadId}`;

  const form = new FormData();
  form.append("files", fs.createReadStream(tmpFilePath));

  const res = await axios.post(uploadUrl, form, { headers: form.getHeaders() });

  fs.unlinkSync(tmpFilePath);

  const serverPath = res.data[0];
  return {
    path: serverPath,
    url: `${BASE_URL}/gradio_api/file=${serverPath}`,
    orig_name: path.basename(tmpFilePath),
    size: response.data.length,
    mime_type: "image/jpeg",
    meta: { _type: "gradio.FileData" },
  };
}

async function processImage(uploadedFileData) {
  return new Promise(async (resolve, reject) => {
    try {
      const sessionHash = generateRandomId();
      const joinPayload = {
        data: [uploadedFileData],
        event_data: null,
        fn_index: 0,
        trigger_id: 5,
        session_hash: sessionHash,
      };

      await axios.post(`${BASE_URL}/gradio_api/queue/join?`, joinPayload, {
        headers: { "Content-Type": "application/json" },
      });

      const dataUrl = `${BASE_URL}/gradio_api/queue/data?session_hash=${sessionHash}`;
      const response = await axios.get(dataUrl, { responseType: "stream" });
      const stream = response.data;

      stream.on("data", (chunk) => {
        const lines = chunk
          .toString()
          .split("\n")
          .filter((line) => line.startsWith("data:"));
        for (const line of lines) {
          try {
            const data = JSON.parse(line.substring(5).trim());
            if (data.msg === "process_completed") {
              stream.destroy();
              const output = data.output.data[0];
              const finalUrl =
                output.url || `${BASE_URL}/gradio_api/file=${output.path}`;
              resolve(finalUrl);
              return;
            }
          } catch (e) {}
        }
      });

      stream.on("end", () =>
        reject(new Error("Stream ended without a result."))
      );
      stream.on("error", (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

// ✅ Vercel handler
module.exports = async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).json({
      success: false,
      creator: "minatocodes",
      error: "Missing ?url= parameter",
    });
  }

  try {
    const uploadedFileData = await uploadImageFromUrl(imageUrl);
    const finalImageUrl = await processImage(uploadedFileData);

    res.json({
      success: true,
      creator: "minatocodes",
      input: imageUrl,
      output: finalImageUrl,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      creator: "minatocodes",
      error: error.message,
    });
  }
};
