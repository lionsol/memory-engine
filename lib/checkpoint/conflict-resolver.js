const { withCheckpointDbs } = require("./db");
const {
  extractConfigKey,
  resolvePreferenceConflicts,
} = require("../lifecycle/preference-conflicts.cjs");

function resolveConfigConflicts() {
  console.log("[checkpoint] Resolving config conflicts...");
  let result = {
    profile: "preference_latest_wins",
    candidates: 0,
    groups: 0,
    flagged: 0,
  };

  withCheckpointDbs(({ engineDb, coreDb }) => {
    result = resolvePreferenceConflicts({
      engineDb,
      coreDb,
      log(message) {
        console.log(`  ↳ ${message}`);
      },
    });
  });

  console.log(`[checkpoint] Config conflict resolution: ${result.flagged} conflict(s) flagged`);
  return result.flagged;
}

module.exports = {
  extractConfigKey,
  resolveConfigConflicts,
};
