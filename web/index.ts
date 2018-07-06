import * as tf from '@tensorflow/tfjs';
import {
  from,
  fromEvent,
  interval,
  merge,
  BehaviorSubject,
  combineLatest
} from 'rxjs';
import {
  flatMap,
  switchMap,
  takeUntil,
  mapTo,
  map,
  startWith,
  distinctUntilChanged
} from 'rxjs/operators';
import { RobotController } from './robot';
import { createTopic$ } from './topic';
import { handleKeyEvent } from './keyEventHandler';
import { setupCamera } from './camera';

const enum Command {
  Backward = 0,
  Neutral = 1,
  Forward = 2
}

const enum CameraSide {
  Left = 'Left',
  Right = 'Right'
}

const commandCount = 3;

const enum ModelStatus {
  Preparing = 'Preparing',
  Ready = 'Ready',
  Training = 'Training',
  Trained = 'Trained',
  Predict = 'Predict'
}

const MODEL_URL =
  'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json';

const loadMobilenet = async (url: string): Promise<tf.Model> => {
  const mn = await tf.loadModel(url);
  const layer = mn.getLayer('conv_pw_13_relu');
  return tf.model({
    inputs: mn.input,
    outputs: layer.output
  });
};

const createPressStream = (el: Element) =>
  fromEvent(el, 'mousedown').pipe(
    switchMap(_ => interval(10).pipe(takeUntil(fromEvent(window, 'mouseup'))))
  );

const cropImageLeft = (image: tf.Tensor): tf.Tensor => {
  const [height, width] = image.shape;
  const size = height;
  const destWidth = size * 2;
  const destHeight = size;

  const begin = [(height - destHeight) / 2, (width - destWidth) / 2, 0];
  const cropped = image.slice(begin, [destHeight, destWidth, 3]);

  return cropped.slice([0, size, 0], [size, size, 3]); // return sliced only right size
};

const cropImageRight = (image: tf.Tensor): tf.Tensor => {
  const [height, width] = image.shape;
  const size = height;
  const destWidth = size * 2;
  const destHeight = size;

  const begin = [(height - destHeight) / 2, (width - destWidth) / 2, 0];
  const cropped = image.slice(begin, [destHeight, destWidth, 3]);

  return cropped.slice(begin, [size, size, 3]); // return sliced only left size
};

const capture = (webcam: HTMLVideoElement, side: CameraSide): tf.Tensor =>
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

let robotController: RobotController;
let model: tf.Model;
let mobilenet: tf.Model;
let webcamera: HTMLVideoElement;
const examples: { xs: any | null; ys: any | null } = {
  xs: null,
  ys: null
};

const LEARNING_RATE = 0.0001;
const BATCH_SIZE_FRACTION = 0.4;
const EPOCHS = 20;
const HIDDEN_UNITS = 100;

const activeCameraSideSubject = new BehaviorSubject<CameraSide | null>(null);

// to count the number of example. [backward, neutral, forword]
const exampleCountsSubject = new BehaviorSubject<number[]>([0, 0, 0]);

const modelStatusSubject = new BehaviorSubject<ModelStatus>(
  ModelStatus.Preparing
);

const predictionResultSubject = new BehaviorSubject<Command | null>(null);

const lossSubject = new BehaviorSubject<number | null>(null);

const resetAll = () => {
  if (examples.xs) {
    examples.xs.dispose();
    examples.ys.dispose();
    examples.xs = null;
    examples.ys = null;
  }
  exampleCountsSubject.next([0, 0, 0]);
  modelStatusSubject.next(ModelStatus.Ready);
  predictionResultSubject.next(null);
};

const addExample = (label: Command, example: any) => {
  const y = tf.tidy(() => {
    return tf.oneHot(tf.tensor1d([label]).toInt(), commandCount);
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

const startTraining = async () => {
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
        units: commandCount,
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

  await model.fit(examples.xs, examples.ys, {
    batchSize,
    epochs: EPOCHS,
    callbacks: {
      onBatchEnd: async (_batch, logs?) => {
        if (logs) {
          lossSubject.next(logs.loss);
        }
        await tf.nextFrame();
      },
      onTrainEnd: async _logs => {
        modelStatusSubject.next(ModelStatus.Trained);
      }
    }
  });
};

const predict = async () => {
  const activeSide = activeCameraSideSubject.value;

  if (activeSide === null) {
    throw new Error('no active image side for prediction');
  }

  const predicted = tf.tidy(() => {
    const img = capture(webcamera, activeSide);
    const activation = mobilenet.predict(img);
    const predictions = model.predict(activation) as tf.Tensor;
    return predictions.as1D().argMax();
  });

  const classid = (await predicted.data())[0];
  predicted.dispose();
  return classid;
};

const setupUI = async () => {
  webcamera = document.querySelector('#webcam') as HTMLVideoElement;
  await setupCamera({
    target: webcamera,
    selector: document.getElementById('camera-selector') as HTMLSelectElement,
    option: { width: 448, height: 224 }
  });

  // workaround
  const image = capture(webcamera, CameraSide.Left);
  mobilenet.predict(image);

  const webcamBox = document.querySelector('.webcam-box')!;

  const neutralButton = document.querySelector('.neutral')!;
  const forwardButton = document.querySelector('.forward')!;
  const backwardButton = document.querySelector('.backward')!;
  const addExampleButtons = [backwardButton, neutralButton, forwardButton];

  const neutralCount = document.querySelector('.neutral-count')!;
  const forwardCount = document.querySelector('.forward-count')!;
  const backwardCount = document.querySelector('.backward-count')!;

  const trainButton = document.querySelector('.train')!;
  const startPredictButton = document.querySelector('.start-predict')!;
  const stopPredictButton = document.querySelector('.stop-predict')!;
  const logMessage = document.querySelector('.log-message')!;

  const neutralPress$ = createPressStream(neutralButton).pipe(
    mapTo(Command.Neutral)
  );
  const forwardPress$ = createPressStream(forwardButton).pipe(
    mapTo(Command.Forward)
  );
  const backPress$ = createPressStream(backwardButton).pipe(
    mapTo(Command.Backward)
  );

  merge(backPress$, neutralPress$, forwardPress$)
    .pipe(
      map(label => {
        const activeSide = activeCameraSideSubject.value;
        if (activeSide === null) {
          throw new Error('no active image side for training');
        }
        const image = capture(webcamera, activeSide);
        const example = mobilenet.predict(image);
        return { label, example };
      })
    )
    .subscribe(({ label, example }) => {
      addExample(label, example);

      const counts = exampleCountsSubject.value;
      counts[label] = counts[label] + 1;
      exampleCountsSubject.next(counts);
    });

  exampleCountsSubject.subscribe(([bw, ne, fw]) => {
    backwardCount.textContent = `${bw}`;
    neutralCount.textContent = `${ne}`;
    forwardCount.textContent = `${fw}`;
  });

  const trainClick$ = fromEvent(trainButton, 'click');
  trainClick$.pipe(mapTo(ModelStatus.Training)).subscribe(modelStatusSubject);
  trainClick$.subscribe(_ => startTraining());

  const startClick$ = fromEvent(startPredictButton, 'click');
  const stopClick$ = fromEvent(stopPredictButton, 'click');

  startClick$
    .pipe(
      switchMap(_ => interval(300).pipe(takeUntil(stopClick$))),
      flatMap(_ => from(predict()))
    )
    .subscribe(predictionResultSubject);

  startClick$.pipe(mapTo(ModelStatus.Predict)).subscribe(modelStatusSubject);

  predictionResultSubject.subscribe(result => {
    addExampleButtons.forEach(b => b.removeAttribute('predicted'));
    if (result !== null) {
      const button = addExampleButtons[result];
      button.setAttribute('predicted', 'true');
    }
  });

  predictionResultSubject.subscribe(label => {
    if (label !== null) {
      const velocity = label - 1; // label to velocity
      robotController.setVelocity(velocity);
    }
  });

  activeCameraSideSubject.subscribe(side => {
    resetAll();

    webcamBox.classList.remove('left');
    webcamBox.classList.remove('right');

    switch (side) {
      case CameraSide.Left:
        webcamBox.classList.add('left');
        return;
      case CameraSide.Right:
        webcamBox.classList.add('right');
        return;
    }
  });

  stopClick$.subscribe(_ => {
    robotController.setVelocity(0);
    resetAll();
  });

  fromEvent(window, 'hashchange')
    .pipe(
      map(() => window.location.hash),
      startWith(window.location.hash)
    )
    .subscribe(hash => {
      if (!hash) {
        activeCameraSideSubject.next(null);
      } else {
        const [, side] = hash.slice(1).split('/');
        if (side === 'right') {
          activeCameraSideSubject.next(CameraSide.Right);
        } else if (side === 'left') {
          activeCameraSideSubject.next(CameraSide.Left);
        } else {
          activeCameraSideSubject.next(null);
        }
      }
    });

  // Setup button status;

  const setEnable = (elem: Element, enabled: boolean) => {
    if (enabled) {
      elem.removeAttribute('disabled');
    } else {
      elem.setAttribute('disabled', 'true');
    }
  };

  modelStatusSubject.subscribe(status => {
    switch (status) {
      case ModelStatus.Preparing:
        addExampleButtons.forEach(b => setEnable(b, false));
        break;
      case ModelStatus.Ready:
        addExampleButtons.forEach(b => setEnable(b, true));
        setEnable(trainButton, true);
        setEnable(startPredictButton, false);
        setEnable(stopPredictButton, false);
        break;
      case ModelStatus.Training:
        setEnable(trainButton, false);
        break;
      case ModelStatus.Trained:
        setEnable(startPredictButton, true);
        break;
      case ModelStatus.Predict:
        setEnable(startPredictButton, false);
        setEnable(stopPredictButton, true);
        break;
    }
  });

  // Setup log message
  combineLatest(
    modelStatusSubject.pipe(distinctUntilChanged()),
    lossSubject
  ).subscribe(([status, loss]) => {
    let message = '';
    switch (status) {
      case ModelStatus.Preparing:
        message = 'Prepareing...';
        break;
      case ModelStatus.Training:
        if (loss) {
          message = `Training: Loss = ${loss.toFixed(5)}`;
        }
        break;
      case ModelStatus.Trained:
        if (loss) {
          message = `Done: Loss = ${loss.toFixed(5)}`;
        }
        break;
      case ModelStatus.Predict:
        if (loss) {
          message = `Running: Loss = ${loss.toFixed(5)}`;
        }
    }
    logMessage.textContent = message;
  });
};

window.onload = () => {
  const hash = window.location.hash.slice(1);
  if (!hash) {
    window.location.hash = '#nobunaga/left'; // Navigate to left controll by default
  }
};

(async () => {
  const topic$ = createTopic$(window);
  const targetSelectors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('#target-selector a')
  );
  topic$.subscribe(topic =>
    targetSelectors.forEach(a => {
      if (a.getAttribute('href') === `#${topic}`) {
        a.classList.add('active');
      } else {
        a.classList.remove('active');
      }
    })
  );
  [robotController, mobilenet] = await Promise.all([
    RobotController.createInstance(topic$),
    loadMobilenet(MODEL_URL),
    handleKeyEvent(topic$)
  ]);
  await setupUI();
})().catch(err => console.error(err));
