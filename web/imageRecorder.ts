import { Subject, fromEvent } from 'rxjs';
import { throttleTime } from 'rxjs/operators';

import { uploadImage, getTemporaryLink } from './api';

const QRCode = require('qrcodejs2');

export class ImageRecorder {
  readonly images$ = new Subject<[HTMLCanvasElement, HTMLCanvasElement]>();
  private _recordedImages: ReadonlyArray<[string] | [string, string]> = [];
  private selectedIndex = 0;
  private _hideLeft = false;
  private _hideRight = false;

  private readonly modal = document.querySelector('.modal-recorded-images')!;
  private readonly clearRecordsButton = document.querySelector(
    '.clear-records'
  )!;
  private readonly previousImageButton = document.querySelector(
    '.previous-image'
  )! as HTMLButtonElement;
  private readonly nextImageButton = document.querySelector(
    '.next-image'
  )! as HTMLButtonElement;
  private readonly toggleLeftButton = document.querySelector(
    '.toggle-left-image'
  );
  private readonly toggleRightButton = document.querySelector(
    '.toggle-right-image'
  );
  private readonly shareButton = document.querySelector('.share-image')!;
  private readonly closeQRCodeButton = document.querySelector('.close-qrcode')!;
  private readonly viewer = document.querySelector(
    '.recorded-image-viewer'
  )! as HTMLCanvasElement;

  private readonly qrCode = new QRCode(document.querySelector('.image-qrcode'));

  constructor(private readonly imageSize: number) {
    // record image every 10 seconds
    this.images$.pipe(throttleTime(10000)).subscribe(images => {
      this.recordedImages = [
        ...this.recordedImages,
        images.map(image => image.toDataURL()) as [string] | [string, string]
      ];
    });

    // clear recorded images
    fromEvent(this.clearRecordsButton, 'click').subscribe(e => {
      e.preventDefault();
      this.recordedImages = [];
    });

    // go back and forth on modal
    fromEvent(this.previousImageButton, 'click').subscribe(() => {
      if (this.selectedIndex - 1 < 0) {
        this.selectedIndex = this.recordedImages.length - 1;
      } else {
        this.selectedIndex -= 1;
      }
      this.writeImageOnViewer();
    });
    fromEvent(this.nextImageButton, 'click').subscribe(() => {
      if (this.selectedIndex + 1 >= this.recordedImages.length) {
        this.selectedIndex = 0;
      } else {
        this.selectedIndex += 1;
      }
      this.writeImageOnViewer();
    });

    // toggle display state of images
    this.toggleLeftButton &&
      fromEvent(this.toggleLeftButton, 'click').subscribe(
        () => (this.hideLeft = !this.hideLeft)
      );
    this.toggleRightButton &&
      fromEvent(this.toggleRightButton, 'click').subscribe(
        () => (this.hideRight = !this.hideRight)
      );

    // share image
    fromEvent(this.shareButton, 'click').subscribe(async () => {
      this.shareButton.classList.add('loading');
      try {
        const blob = await new Promise<Blob>(resolve =>
          this.viewer.toBlob(blob => resolve(blob!))
        );

        const { name } = await uploadImage(blob).then(
          async res =>
            res.ok ? res.json() : Promise.reject(new Error(await res.text()))
        );

        const { link } = await getTemporaryLink(name).then(
          async res =>
            res.ok ? res.json() : Promise.reject(new Error(await res.text()))
        );

        this.qrCode.makeCode(link);
        this.modal.classList.add('display-qrcode');
      } catch (e) {
        console.error(e);
        alert('Failed! Open console for detail.');
      }
      this.shareButton.classList.remove('loading');
    });

    fromEvent(this.closeQRCodeButton, 'click').subscribe(() => {
      this.qrCode.clear();
      this.modal.classList.remove('display-qrcode');
    });
  }

  addImageURLs(urls: [string, string]) {
    this.recordedImages = [...this.recordedImages, urls];
  }

  displayImages() {
    if (0 < this.recordedImages.length) {
      this.selectedIndex = 0;
      this.writeImageOnViewer();
    }
  }

  private get recordedImages(): ReadonlyArray<[string] | [string, string]> {
    return this._recordedImages;
  }

  private set recordedImages(
    recordedImages: ReadonlyArray<[string] | [string, string]>
  ) {
    this.toggleRecordButtonsDisabled(recordedImages);
    this._recordedImages = recordedImages;
  }

  private toggleRecordButtonsDisabled(
    recordedImages: ReadonlyArray<[string] | [string, string]>
  ): void {
    this.clearRecordsButton.classList.toggle(
      'disabled',
      recordedImages.length === 0
    );
  }

  private get hideLeft(): boolean {
    return this._hideLeft;
  }
  private set hideLeft(hideLeft: boolean) {
    if (hideLeft && this._hideRight) {
      this._hideRight = false;
      this.modal.classList.remove('hide-right-image');
    }
    this.modal.classList.toggle('hide-left-image', hideLeft);
    this._hideLeft = hideLeft;
    this.writeImageOnViewer();
  }

  private get hideRight(): boolean {
    return this._hideRight;
  }
  private set hideRight(hideRight: boolean) {
    if (hideRight && this._hideLeft) {
      this._hideLeft = false;
      this.modal.classList.remove('hide-left-image');
    }
    this.modal.classList.toggle('hide-right-image', hideRight);
    this._hideRight = hideRight;
    this.writeImageOnViewer();
  }

  private writeImageOnViewer() {
    const root = document.querySelector('#root')!;
    const style = getComputedStyle(root);

    const images = this.recordedImages[this.selectedIndex];
    if (images.length === 1 || this.hideRight) {
      this.writeSingleImageOnViewer(images[0], style).catch(e =>
        console.error(e)
      );
    } else if (this.hideLeft) {
      this.writeSingleImageOnViewer(images[1], style).catch(e =>
        console.error(e)
      );
    } else {
      this.writeTwoImagesOnViewer(images[0], images[1], style).catch(e =>
        console.error(e)
      );
    }
  }

  private async writeSingleImageOnViewer(
    imageSrc: string,
    style: CSSStyleDeclaration
  ) {
    const borderColor = style.getPropertyValue('--camerabox-border-color');

    const ctx = this.viewer.getContext('2d')!;
    this.resetBackground(ctx, style);

    const centerX = ctx.canvas.width / 2.0;
    const top = 140;
    const left = centerX - this.imageSize / 2.0;

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.shadowBlur = 20;
    ctx.shadowColor = ctx.strokeStyle;
    const halfLineWidth = ctx.lineWidth / 2;
    ctx.rect(
      left - halfLineWidth,
      top - halfLineWidth,
      this.imageSize + ctx.lineWidth,
      this.imageSize + ctx.lineWidth
    );
    ctx.stroke();

    ctx.scale(-1, 1);
    ctx.drawImage(await this.loadImage(imageSrc), -left - this.imageSize, top);
    ctx.scale(-1, 1);

    ctx.strokeStyle = 'transparent';
    ctx.shadowColor = 'transparent';
  }

  private async writeTwoImagesOnViewer(
    leftSrc: string,
    rightSrc: string,
    style: CSSStyleDeclaration
  ) {
    const ctx = this.viewer.getContext('2d')!;
    const borderColor = style.getPropertyValue('--camerabox-border-color');

    this.resetBackground(ctx, style);

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.shadowBlur = 20;
    ctx.shadowColor = ctx.strokeStyle;

    const halfLineWidth = ctx.lineWidth / 2;

    const top = 140;
    const betweenSpace = 80;
    const centerX = ctx.canvas.width / 2.0;

    const left = centerX - betweenSpace / 2.0 - this.imageSize;

    ctx.rect(
      left - halfLineWidth,
      top - halfLineWidth,
      this.imageSize + ctx.lineWidth,
      this.imageSize + ctx.lineWidth
    );
    ctx.stroke();
    ctx.rect(
      centerX + betweenSpace / 2.0 + halfLineWidth,
      top - halfLineWidth,
      this.imageSize + ctx.lineWidth,
      this.imageSize + ctx.lineWidth
    );
    ctx.stroke();

    ctx.scale(-1, 1);
    ctx.drawImage(await this.loadImage(leftSrc), -left - this.imageSize, top);
    ctx.drawImage(
      await this.loadImage(rightSrc),
      -(centerX + betweenSpace / 2.0 + this.imageSize + ctx.lineWidth),
      top
    );
    ctx.scale(-1, 1);

    ctx.strokeStyle = 'transparent';
    ctx.shadowColor = 'transparent';
  }

  private resetBackground(
    ctx: CanvasRenderingContext2D,
    style: CSSStyleDeclaration
  ): void {
    const bgColor = style.getPropertyValue('--bg-color');
    const gridColor = style.getPropertyValue('--bg-grid-color');
    const mainColor = style.getPropertyValue('--main-color');
    const accentColor = style.getPropertyValue('--accent-color');

    ctx.clearRect(0, 0, this.viewer.width, this.viewer.height);

    ctx.beginPath();
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, this.viewer.width, this.viewer.height);

    let x = 0;
    while (x < this.viewer.width) {
      const gradient = ctx.createLinearGradient((x += 10), 0, 1, 0);
      gradient.addColorStop(0, gridColor);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, 0, 1, this.viewer.height);
    }
    let y = 0;
    while (y < this.viewer.height) {
      const gradient = ctx.createLinearGradient(0, (y += 10), 0, 1);
      gradient.addColorStop(0, gridColor);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, y, this.viewer.width, 1);
    }

    ctx.font = '32px PixelMPlus';
    ctx.fillStyle = mainColor;
    ctx.shadowBlur = 8;
    ctx.shadowColor = ctx.fillStyle;
    ctx.textAlign = 'center';
    ctx.fillText('ガンメンタイセン', this.viewer.width / 2, 60);

    ctx.font = '16px PixelMPlus';
    ctx.fillStyle = accentColor;
    ctx.shadowColor = ctx.fillStyle;
    ctx.fillText('カブク @Maker Faire Tokyo 2018', this.viewer.width / 2, 96);

    ctx.fillStyle = 'transparent';
    ctx.shadowColor = 'transparent';
  }

  private loadImage(image: string): Promise<HTMLImageElement> {
    const img = new Image();
    const result = new Promise<HTMLImageElement>(
      resolve => (img.onload = () => resolve(img))
    );
    img.src = image;
    return result;
  }
}
