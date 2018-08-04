import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import util from 'util';
import { uploadPlayImage } from './uploadPlayImage';

const Bundler = require('parcel-bundler');

// const bundler = new Bundler('./web/index.html');
const bundler = new Bundler('./web/singleplay.html');
const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/upload', (req, res) => {
  const basename = `${Date.now()}-${crypto
    .randomBytes(10)
    .toString('hex')}.gif`;
  const fileName = path.join('./play-images', basename);
  util
    .promisify(fs.writeFile)(fileName, Buffer.from(req.body.data, 'base64'))
    .then(async () => {
      const uploaded = await uploadPlayImage(fileName).then(
        () => true,
        () => false
      );
      res.status(200).json({
        url: `https://storage.googleapis.com/${
          process.env.GCS_BUCKET_NAME
        }/${basename}`,
        uploaded
      });
    }, err => console.error(err) || res.status(500).send(err));
});

app.use(bundler.middleware());

app.listen(1234, () => console.log('Service running of 1234'));
