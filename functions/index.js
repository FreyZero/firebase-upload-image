const functions = require("firebase-functions");
const os = require("os");
const path = require("path");
const spawn = require("child-process-promise").spawn;
const cors = require("cors")({ origin: true });
const Busboy = require("busboy");
const fs = require("fs");
const UUID = require("uuid-v4");

const gcconfig = {
    projectId: "ratchaponproject",
    keyFilename: "ratchaponproject-firebase-adminsdk-853pb-902fea8bb3.json"
};

const gcs = require("@google-cloud/storage")(gcconfig);
// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
exports.onFileChange = functions.storage.object().onChange(event => {
    const object = event.data;
    const bucket = object.bucket;
    const contentType = object.contentType;
    const filePath = object.name;
    console.log("File change detected, function execution started");

    if (object.resourceState === "not_exists") {
        console.log("We deleted a file, exit...");
        return;
    }

    if (path.basename(filePath).startsWith("resized-")) {
        console.log("We already renamed that file!");
        return;
    }

    const destBucket = gcs.bucket(bucket);
    const tmpFilePath = path.join(os.tmpdir(), path.basename(filePath));
    const metadata = { contentType: contentType };
    return destBucket
        .file(filePath)
        .download({
            destination: tmpFilePath
        })
        .then(() => {
            return spawn("convert", [tmpFilePath, "-resize", "500x500", tmpFilePath]);
        })
        .then(() => {
            return destBucket.upload(tmpFilePath, {
                destination: "resized-" + path.basename(filePath),
                metadata: metadata
            });
        });
});

exports.uploadFile = functions.https.onRequest((req, res) => {
    let uuid = UUID();
    cors(req, res, () => {
        if (req.method !== "POST") {
            return res.status(500).json({
                message: "Not allowed"
            });
        }
        const busboy = new Busboy({ headers: req.headers });
        let uploadData = null;

        busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
            const filepath = path.join(os.tmpdir(), filename);
            uploadData = { file: filepath, type: mimetype };
            file.pipe(fs.createWriteStream(filepath));
        });

        busboy.on("finish", () => {
            const bucket = gcs.bucket("ratchaponproject.appspot.com");
            bucket
                .upload(uploadData.file, {
                    uploadType: "media",
                    metadata: {
                        metadata: {
                            contentType: uploadData.type,
                            firebaseStorageDownloadTokens: uuid
                        }
                    }
                })
                .then((uploadedFile) => {
                    let file = uploadedFile[0];
                    res.status(200).json({
                        message: "It worked!",
                        downloadURL: "https://firebasestorage.googleapis.com/v0/b/" + bucket.name + "/o/" + encodeURIComponent(file.name) + "?alt=media&token=" + uuid,
                        data: uploadedFile.metadata
                    });
                })
                .catch(err => {
                    res.status(500).json({
                        error: err
                    });
                });
        });
        busboy.end(req.rawBody);
    });
});