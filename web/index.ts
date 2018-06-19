import * as tf from '@tensorflow/tfjs';
import { fromEvent, interval, asyncScheduler, merge, BehaviorSubject } from 'rxjs';
import { switchMap, takeUntil, mapTo, map } from 'rxjs/operators';
import { Robot, RobotController, Wheel } from './robot';

enum Command {
  Neutral = 0,
  Forward = 1,
  Backward = 2
}

namespace Command {
  export const length = 3
}

const velocityInput = document.getElementById('velocityInput') as HTMLInputElement;
const sendButton = document.getElementById('sendButton') as HTMLButtonElement;

RobotController
  .createInstance(Robot.NOBUNAGA, Wheel.LEFT)
  .then(controller =>
    sendButton.addEventListener('click', async () =>
      await controller.setVelocity(Number(velocityInput.value) || 0)
    )
  )
  .catch(e => console.error(e));

const MODEL_URL = 'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json';

const loadMobilenet = async (url: string): Promise<tf.Model> => {
  const mn = await tf.loadModel(url);
  const layer = mn.getLayer('conv_pw_13_relu');
  return tf.model({
    inputs: mn.input,
    outputs: layer.output
  })
};

const setupWebcamera = async (webcam: HTMLVideoElement) => {
  webcam.addEventListener('loadeddata', async () => {
    const { videoWidth, videoHeight } = webcam;
    const aspectRatio = videoWidth / videoHeight;

    if (videoWidth < videoHeight) {
      webcam.height = webcam.width / aspectRatio;
    } else {
      webcam.width = aspectRatio * webcam.height;
    }
  });

  try {
    const stream = await navigator
      .mediaDevices
      .getUserMedia({ video: true, audio: false });
    webcam.srcObject = stream;

  } catch (err) {
    console.error(err);
  }
};

const createPressStream = (el: Element) => fromEvent(el, 'mousedown')
  .pipe(
    switchMap(_ =>
      interval(0, asyncScheduler).pipe(
        takeUntil(fromEvent(window, 'mouseup'))
      )
    )
  );

/**
 * Resize the given image tensor to a squred one.
 */
const cropImage = (image: tf.Tensor): tf.Tensor => {
  const [height, width] = image.shape;
  const size = Math.min(width, height);
  const start = [(height - size) / 2, (width - size) / 2, 0];
  const end = [size, size, 3];
  return image.slice(start, end);
};

const capture = (webcam: HTMLVideoElement): tf.Tensor => tf.tidy(() => {
  const webcamImage = tf.fromPixels(webcam);
  const cropped = cropImage(webcamImage);
  const expanded = cropped.expandDims();
  return expanded.toFloat().div(tf.scalar(127)).sub(tf.scalar(1));
});

let model: tf.Model;
let mobilenet: tf.Model;
let webcamera: HTMLVideoElement;
const examples: { xs: any | null, ys: any | null } = {
  xs: null,
  ys: null
};

const LEARNING_RATE = 0.0001;
const BATCH_SIZE_FRACTION = 0.4;
const EPOCHS = 20;
const HIDDEN_UNITS = 100;

const exampleCountsSubject = new BehaviorSubject<number[]>([0, 0, 0]);
const modelStatusSubject = new BehaviorSubject<string>('');

const addExample = (label: Command, example: any) => {
  const y = tf.tidy(() => {
    return tf.oneHot(tf.tensor1d([label]).toInt(), Command.length);
  });
  if (examples.xs === null) {
    examples.xs = tf.keep(example);
    examples.ys = tf.keep(y);
  } else {
    const oldX = examples.xs;
    const oldY = examples.ys;

    examples.xs = tf.keep(oldX.concat(example));
    examples.ys = tf.keep(oldY.concat(y));

    oldX.dispose();
    oldY.dispose();
    y.dispose();
  }
};

const startTraining = () => {

  if (examples.xs === null) {
    throw new Error('Add some examples before training!');
  }

  model = tf.sequential({
    layers: [
      tf.layers.flatten({ inputShape: [7, 7, 256] }),

      tf.layers.dense({
        units: HIDDEN_UNITS,
        activation: 'relu',
        kernelInitializer: 'varianceScaling',
        useBias: true
      }),

      tf.layers.dense({
        units: Command.length,
        kernelInitializer: 'varianceScaling',
        useBias: false,
        activation: 'softmax'
      })
    ]
  });

  const optimizer = tf.train.adam(LEARNING_RATE);

  model.compile({ optimizer, loss: 'categoricalCrossentropy' });

  const batchSize = Math.floor(examples.xs.shape[0] * BATCH_SIZE_FRACTION);
  if (batchSize <= 0) {
    throw new Error('Batch size is 0 or NaN.');
  }

  model.fit(examples.xs, examples.ys, {
    batchSize,
    epochs: EPOCHS,
    callbacks: {
      onBatchEnd: async (_batch, logs?) => {
        if (logs) {
          modelStatusSubject.next(`Loss: ${logs.loss.toFixed(5)}`);
        }
        await tf.nextFrame();
      },
      onTrainEnd: async (_logs) => {
        const result = modelStatusSubject.value;
        modelStatusSubject.next(`Done. (${result})`);
      }
    }
  });
};

const setupUI = () => {
  webcamera = document.querySelector('#webcam') as HTMLVideoElement;
  setupWebcamera(webcamera);

  // workaround
  const image = capture(webcamera);
  const _ = mobilenet.predict(image);

  const neutralButton = document.querySelector('.neutral');
  const backwardButton = document.querySelector('.backward');
  const forwardButton = document.querySelector('.forward');

  const trainButton = document.querySelector('.train');
  const modelStatus = document.querySelector('.model-status');

  const neutralPress$ = createPressStream(neutralButton!).pipe(mapTo(Command.Neutral));
  const backPress$ = createPressStream(backwardButton!).pipe(mapTo(Command.Backward));
  const forwardPress$ = createPressStream(forwardButton!).pipe(mapTo(Command.Forward));

  merge(backPress$, neutralPress$, forwardPress$)
    .pipe(
      map(label => {
        const image = capture(webcamera);
        const example = mobilenet.predict(image);
        return { label, example };
      })
    )
    .subscribe(({ label, example }) => {
      addExample(label, example);
    });

  const trainClick$ = fromEvent(trainButton!, 'click');
  trainClick$.subscribe(_ => startTraining());

  modelStatusSubject.subscribe(status => {
    modelStatus!.textContent = status;
  });
};

(async () => {
  mobilenet = await loadMobilenet(MODEL_URL);
  setupUI();
})();
