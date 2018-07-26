import * as tf from '@tensorflow/tfjs';
import { Observable, BehaviorSubject } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';

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

export const enum ControlStatus {
  Stopped = 'Stopped',
  Started = 'Started'
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
  readonly exampleCounts$: Observable<number[]>;
  readonly modelStatus$: Observable<ModelStatus>;
  readonly controlStatus$: Observable<ControlStatus>;
  readonly lossRate$: Observable<number | null>;
  readonly predictionResult$: Observable<Command | null>;

  private model: tf.Model | null = null;

  private examples: Examples = {
    xs: null,
    ys: null
  };

  private readonly exampleCounts: BehaviorSubject<number[]>;
  private readonly modelStatus: BehaviorSubject<ModelStatus>;
  private readonly controlStatus: BehaviorSubject<ControlStatus>;
  private readonly lossRate: BehaviorSubject<number | null>;
  private readonly predictionResult: BehaviorSubject<Command | null>;
  private readonly commandLabelDiff: number;

  constructor(public easyMode: boolean) {
    this.exampleCounts = new BehaviorSubject([0, 0, 0]);
    this.modelStatus = new BehaviorSubject(ModelStatus.Preparing);
    this.controlStatus = new BehaviorSubject(ControlStatus.Stopped);
    this.lossRate = new BehaviorSubject<number | null>(null);
    this.predictionResult = new BehaviorSubject<Command | null>(null);

    this.exampleCounts$ = this.exampleCounts.asObservable();
    this.modelStatus$ = this.modelStatus.pipe(distinctUntilChanged());
    this.controlStatus$ = this.controlStatus.pipe(distinctUntilChanged());
    this.lossRate$ = this.lossRate.asObservable();
    this.predictionResult$ = this.predictionResult.pipe(distinctUntilChanged());
    this.commandLabelDiff = Number(easyMode);
  }

  addExample = (command: Command, example: any) => {
    const label = command - this.commandLabelDiff;
    const y = tf.tidy(() => {
      return tf.oneHot(
        tf.tensor1d([label]).toInt(),
        commandCount - this.commandLabelDiff
      );
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
    counts[command] = counts[command] + 1;
    this.exampleCounts.next(counts);
  };

  setReady() {
    this.modelStatus.next(ModelStatus.Ready);
  }

  setControlStatus(controlStatus: ControlStatus) {
    this.controlStatus.next(controlStatus);
  }

  clearPrediction() {
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
          units: commandCount - this.commandLabelDiff,
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
          this.examples.xs.dispose();
          this.examples.ys.dispose();
          this.examples.xs = null;
          this.examples.ys = null;
          this.exampleCounts.next([0, 0, 0]);
          this.modelStatus.next(ModelStatus.Trained);
        }
      }
    });
  };

  async predict(image: tf.Tensor, mobilenet: tf.Model) {
    const predicted = tf.tidy(() => {
      if (this.model === null) {
        throw new Error('trained model is unavailable');
      }
      const activation = mobilenet.predict(image);
      const predictions = this.model.predict(activation) as tf.Tensor;
      return predictions.as1D().argMax();
    });

    const command = (await predicted.data())[0] + this.commandLabelDiff;

    image.dispose();
    predicted.dispose();

    this.predictionResult.next(command);

    await tf.nextFrame();

    return command;
  }

  hasModel(): boolean {
    return !!this.model;
  }
}
