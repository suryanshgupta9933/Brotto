import { Composition } from "remotion";
import { Brotto } from "./Brotto";
import { FPS, H, W } from "./tokens";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Brotto"
      component={Brotto}
      durationInFrames={1715}
      fps={FPS}
      width={W}
      height={H}
    />
  );
};
