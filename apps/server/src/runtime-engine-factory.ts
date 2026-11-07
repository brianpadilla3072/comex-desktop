import { createEngineV2Preview } from "./engine-v2-preview.js";
import { FactoryRegistry } from "./specialists/factories.js";

/** Current desktop gateway contract. A future engine adapter must implement the
 * session/tool/model facade consumed by the app; declaring an id is not support. */
export const runtimeEngineFactories = new FactoryRegistry<Parameters<typeof createEngineV2Preview>[0], ReturnType<typeof createEngineV2Preview>>([{
  id: "opencode", label: "OpenCode", create: createEngineV2Preview,
}]);
export const createRuntimeEngine = (options: Parameters<typeof createEngineV2Preview>[0]) => runtimeEngineFactories.create("opencode", options);
