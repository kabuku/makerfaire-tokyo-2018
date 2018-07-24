import * as tf from '@tensorflow/tfjs';
import { fromEvent, Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

export const enum CameraSide {
  Left = 'Left',
  Right = 'Right'
}

export interface CameraManagerParameter {
  targets: HTMLVideoElement[];
  selector: HTMLSelectElement;
  option?: MediaTrackConstraints;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function setupCamera({
  targets,
  selector,
  option = {}
}: CameraManagerParameter): Promise<void> {
  const cameras = await navigator.mediaDevices
    .enumerateDevices()
    .then(devices => devices.filter(({ kind }) => kind === 'videoinput'));
  if (cameras.length === 0) {
    return Promise.reject(new Error('This device does not have cameras'));
  }

  targets.forEach((element: HTMLVideoElement) => {
    element.addEventListener('loadedmetadata', () => {
      const { videoWidth, videoHeight } = element;
      const aspectRatio = videoWidth / videoHeight;

      if (videoWidth < videoHeight) {
        element.height = element.width / aspectRatio;
      } else {
        element.width = aspectRatio * element.height;
      }
    });
  });

  setupSelector(selector, cameras).subscribe(async exact => {
    const src = await navigator.mediaDevices.getUserMedia({
      video: {
        ...option,
        deviceId: { exact }
      }
    });

    targets.forEach(async (element: HTMLVideoElement) => {
      if (element.srcObject) {
        (element.srcObject as MediaStream)
          .getTracks()
          .forEach(track => track.stop());
      }
      element.srcObject = src;
    });
  });
}

export const capture = (
  webcam: HTMLVideoElement,
  side: CameraSide
): tf.Tensor =>
  tf.tidy(() => {
    const webcamImage = tf.fromPixels(webcam);

    let image: tf.Tensor;

    switch (side) {
      case CameraSide.Left:
        image = cropImageLeft(webcamImage);
        break;
      case CameraSide.Right:
        image = cropImageRight(webcamImage);
        break;
      default:
        throw new Error('select camera side left or right.');
    }
    const expanded = image.expandDims();
    return expanded
      .toFloat()
      .div(tf.scalar(127))
      .sub(tf.scalar(1));
  });

const drawToCanvas = (
  canvas: HTMLCanvasElement,
  videoElem: HTMLVideoElement,
  cameraSide: CameraSide,
  srcRect: Rect,
  imageSize: number = 224
) => {
  const ctx = canvas.getContext('2d')!;

  // flip src rect horizontally
  const { x, y, width, height } = srcRect;
  const offsetX = cameraSide === CameraSide.Right ? imageSize : 0;
  const adjustedX = 2 * imageSize - x - width - offsetX;

  ctx.drawImage(
    videoElem,
    adjustedX,
    y,
    width,
    height,
    0,
    0,
    imageSize,
    imageSize
  );
};

export const captureWithCanvas = (
  canvas: HTMLCanvasElement,
  videoElem: HTMLVideoElement,
  cameraSide: CameraSide,
  srcRect: Rect
): tf.Tensor => {
  drawToCanvas(canvas, videoElem, cameraSide, srcRect);
  return tf.tidy(() => {
    const pixels = tf.fromPixels(canvas);
    const expanded = pixels.expandDims();
    return expanded
      .toFloat()
      .div(tf.scalar(127))
      .sub(tf.scalar(1));
  });
};

function setupSelector(
  selector: HTMLSelectElement,
  cameras: MediaDeviceInfo[]
): Observable<string> {
  const fragment = document.createDocumentFragment();
  for (const { deviceId, label } of cameras) {
    const option = document.createElement('option');
    option.value = deviceId;
    option.textContent = label;
    fragment.appendChild(option);
  }
  selector.appendChild(fragment);
  selector.selectedIndex = 0;
  return fromEvent(selector, 'change').pipe(
    map(() => selector.value),
    startWith(cameras[0].deviceId)
  );
}

function cropImageLeft(image: tf.Tensor): tf.Tensor {
  const [height, width] = image.shape;
  const size = height;
  const destWidth = size * 2;
  const destHeight = size;

  const begin = [(height - destHeight) / 2, (width - destWidth) / 2, 0];
  const cropped = image.slice(begin, [destHeight, destWidth, 3]);

  return cropped.slice([0, size, 0], [size, size, 3]); // return sliced only right size
}

function cropImageRight(image: tf.Tensor): tf.Tensor {
  const [height, width] = image.shape;
  const size = height;
  const destWidth = size * 2;
  const destHeight = size;

  const begin = [(height - destHeight) / 2, (width - destWidth) / 2, 0];
  const cropped = image.slice(begin, [destHeight, destWidth, 3]);

  return cropped.slice(begin, [size, size, 3]); // return sliced only left size
}
