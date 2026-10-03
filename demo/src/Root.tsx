import { Composition } from "remotion";
import { Brag, DURATION as BRAG_DURATION } from "./Brag";
import { Brotto, DURATION } from "./Brotto";
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
      {/* The 20s launch cut. Shorter, hook-first, and built on the same panel
          screenshots — see brag-plan.md. */}
      <Composition
        id="Brag"
        component={Brag}
        durationInFrames={BRAG_DURATION}
        fps={FPS}
        width={W}
        height={H}
      />
    </>
  );
};
