import { Composition } from "remotion";
import { Brotto, DURATION } from "./Brotto";
import { Draft1, DURATION as DRAFT1_DURATION } from "./Draft1";
import { Draft2, DRAFT2_DURATION } from "./Draft2";
import { Draft3, DRAFT3_DURATION } from "./Draft3";
import { FPS, H, W } from "./tokens";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Brotto"
        component={Brotto}
        durationInFrames={DURATION}
        fps={FPS}
        width={W}
        height={H}
      />
      {/* The short cuts. Each argues a different part of the same case, off the
          same panel screenshots — see the plan beside each one. */}
      <Composition
        id="Draft1"
        component={Draft1}
        durationInFrames={DRAFT1_DURATION}
        fps={FPS}
        width={W}
        height={H}
      />
      <Composition
        id="Draft2"
        component={Draft2}
        durationInFrames={DRAFT2_DURATION}
        fps={FPS}
        width={W}
        height={H}
      />
      <Composition
        id="Draft3"
        component={Draft3}
        durationInFrames={DRAFT3_DURATION}
        fps={FPS}
        width={W}
        height={H}
      />
    </>
  );
};
