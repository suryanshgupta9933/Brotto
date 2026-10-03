import { Composition } from "remotion";
import { Brotto, DURATION } from "./Brotto";
import { FPS, H, W } from "./tokens";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Brotto"
      component={Brotto}
      durationInFrames={DURATION}
      fps={FPS}
      width={W}
      height={H}
    />
  );
};
