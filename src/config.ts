import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-secret-ballot",
  description: "Anonymous yes/no ballot via commit-reveal. Soft-anonymity, honest privacy section.",
  accentHex: "#b5b5b5",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
