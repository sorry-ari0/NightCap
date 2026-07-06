import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");
const dbPath = process.env.NIGHTCAP_DATA_PATH || path.join(dataDir, "nightcap-db.json");

const defaultState = {
  ratings: [],
  savedVenueIds: [],
  invites: [],
  sessions: {},
  venueCache: {},
  memberDirectory: [],
  feedback: [],
  posts: []
};

export function loadState() {
  try {
    if (!fs.existsSync(dbPath)) return { ...defaultState };
    const parsed = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    return {
      ratings: Array.isArray(parsed.ratings) ? parsed.ratings : [],
      savedVenueIds: Array.isArray(parsed.savedVenueIds) ? parsed.savedVenueIds : [],
      invites: Array.isArray(parsed.invites) ? parsed.invites : [],
      sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
      venueCache: parsed.venueCache && typeof parsed.venueCache === "object" ? parsed.venueCache : {},
      memberDirectory: Array.isArray(parsed.memberDirectory) ? parsed.memberDirectory : [],
      feedback: Array.isArray(parsed.feedback) ? parsed.feedback : [],
      posts: Array.isArray(parsed.posts) ? parsed.posts : []
    };
  } catch (error) {
    console.error("Failed to load local data store", error);
    return { ...defaultState };
  }
}

export function saveState(state) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const tempPath = `${dbPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2));
  fs.renameSync(tempPath, dbPath);
}
