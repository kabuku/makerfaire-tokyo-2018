import Storage from '@google-cloud/storage';
import path from 'path';
import fs from 'fs';
import util from 'util';
require('dotenv').config();

process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(
  'google-api-key.json'
);

const storage: Storage.Storage = new (Storage as any)({
  projectId: 'maker-faire-tokyo-2018'
});
const uploadedDir = path.join(__dirname, '../play-images-uploaded');

export function uploadPlayImage(fileName: string) {
  return storage
    .bucket(process.env.GCS_BUCKET_NAME!)
    .upload(fileName, {
      gzip: true,
      public: true,
      metadata: {
        // Enable long-lived HTTP caching headers
        // Use only if the contents of the file will never change
        // (If the contents will change, use cacheControl: 'no-cache')
        cacheControl: 'public, max-age=31536000'
      }
    })
    .then(() =>
      util.promisify(fs.rename)(
        fileName,
        path.join(uploadedDir, path.basename(fileName))
      )
    )
    .then(
      () => console.log(`Successfully uploaded ${fileName}`),
      err =>
        console.error(`Failed to upload ${err}`, err) || Promise.reject(err)
    );
}
