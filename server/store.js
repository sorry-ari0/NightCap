import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "nightcap-db.json");

const defaultState = {
  ratings: [],
  savedVenueIds: [],
  invites: []
};

export function loadState() {
  try {
    if (!fs.existsSync(dbPath)) return { ...defaultState };
    const parsed = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    return {
      ratings: Array.isArray(parsed.ratings) ? parsed.ratings : [],
      savedVenueIds: Array.isArray(parsed.savedVenueIds) ? parsed.savedVenueIds : [],
      invites: Array.isArray(parsed.invites) ? parsed.invites : []
    };
  } catch (error) {
    console.error("Failed to load local data store", error);
    return { ...defaultState };
  }
}

export function saveState(state) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(state, null, 2));
}
