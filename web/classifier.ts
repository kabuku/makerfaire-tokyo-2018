import * as tf from '@tensorflow/tfjs';
import { Observable, BehaviorSubject } from 'rxjs';
import { distinctUntilChanged } from '../node_modules/rxjs/operators';

import { CameraSide, capture } from './camera';

export const enum Command {
  Backward = 0,
  Neutral = 1,
  Forward = 2
}

export const commandCount = 3;

export const enum ModelStatus {
  Preparing = 'Preparing',
  Ready = 'Ready',
  Training = 'Training',
  Trained = 'Trained',
  Predict = 'Predict'
}

interface Examples {
  xs: any | null;
  ys: any | null;
}

const LEARNING_RATE = 0.0001;
const BATCH_SIZE_FRACTION = 0.4;
const EPOCHS = 20;
const HIDDEN_UNITS = 100;

export class Classifier {
  cameraSide: CameraSide;

  readonly exampleCounts$: Observable<number[]>;
  readonly modelStatus$: Observable<ModelStatus>;
  readonly lossRate$: Observable<number | null>;
  readonly predictionResult$: Observable<Command | null>;

  private model: tf.Model | null = null;

  private examples: Examples = {
    xs: null,
    ys: null
  };

  private exampleCounts: BehaviorSubject<number[]>;
  private modelStatus: BehaviorSubject<ModelStatus>;
  private lossRate: BehaviorSubject<number | null>;
  private predictionResult: BehaviorSubject<Command | null>;

  constructor(cameraSide: CameraSide) {
    this.cameraSide = cameraSide;

    this.exampleCounts = new BehaviorSubject([0, 0, 0]);
    this.modelStatus = new BehaviorSubject(ModelStatus.Preparing);
    this.lossRate = new BehaviorSubject<number | null>(null);
    this.predictionResult = new BehaviorSubject<Command | null>(null);

    this.exampleCounts$ = this.exampleCounts.asObservable();
    this.modelStatus$ = this.modelStatus.pipe(distinctUntilChanged());
    this.lossRate$ = this.lossRate.asObservable();
    this.predictionResult$ = this.predictionResult.pipe(distinctUntilChanged());
  }

  addExample = (label: Command, example: any) => {
    const y = tf.tidy(() => {
      return tf.oneHot(tf.tensor1d([label]).toInt(), commandCount);
    });
    if (this.examples.xs === null) {
      this.examples.xs = tf.keep(example);
      this.examples.ys = tf.keep(y);
    } else {
      const oldX = this.examples.xs;
      const oldY = this.examples.ys;

      this.examples.xs = tf.keep(oldX.concat(example));
      this.examples.ys = tf.keep(oldY.concat(y));

      oldX.dispose();
      oldY.dispose();
      y.dispose();
    }

    const counts = this.exampleCounts.value;
    counts[label] = counts[label] + 1;
    this.exampleCounts.next(counts);
  };

  resetAll() {
    if (this.examples.xs) {
      this.examples.xs.dispose();
      this.examples.ys.dispose();
      this.examples.xs = null;
      this.examples.ys = null;
    }
    this.exampleCounts.next([0, 0, 0]);
    this.modelStatus.next(ModelStatus.Ready);
    this.predictionResult.next(null);
  }

  startTraining = async () => {
    if (this.examples.xs === null) {
      throw new Error('Add some examples before training!');
    }

    this.modelStatus.next(ModelStatus.Training);

    this.model = tf.sequential({
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

    this.model.compile({ optimizer, loss: 'categoricalCrossentropy' });

    const batchSize = Math.floor(
      this.examples.xs.shape[0] * BATCH_SIZE_FRACTION
    );
    if (batchSize <= 0) {
      throw new Error('Batch size is 0 or NaN.');
    }

    await this.model.fit(this.examples.xs, this.examples.ys, {
      batchSize,
      epochs: EPOCHS,
      callbacks: {
        onBatchEnd: async (_batch, logs?) => {
          if (logs) {
            this.lossRate.next(logs.loss);
          }
          await tf.nextFrame();
        },
        onTrainEnd: async _logs => {
          this.modelStatus.next(ModelStatus.Trained);
        }
      }
    });
  };

  async predict(video: HTMLVideoElement, mobilenet: tf.Model) {
    this.modelStatus.next(ModelStatus.Predict);

    const predicted = tf.tidy(() => {
      if (this.model === null) {
        throw new Error('trained model is unavailable');
      }
      const img = capture(video, this.cameraSide);
      const activation = mobilenet.predict(img);
      const predictions = this.model.predict(activation) as tf.Tensor;
      return predictions.as1D().argMax();
    });

    const classid = (await predicted.data())[0];
    predicted.dispose();

    this.predictionResult.next(classid);

    await tf.nextFrame();

    return classid;
  }
}
