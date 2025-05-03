import dbClient from "../db.server";

export async function getHomepageConfig() {
  try {
    const db = await dbClient.getDB();
    const result = await db.collection("homepage_config").findOne({ type: "main" });
    return result || { sections: [] };
  } catch (error) {
    console.error("Failed to get homepage config:", error);
    // Return empty config if there's an error
    return { sections: [] };
  }
}

export async function updateHomepageConfig(config) {
  try {
    const db = await dbClient.getDB();
    await db.collection("homepage_config").updateOne(
      { type: "main" },
      { $set: { ...config, updatedAt: new Date() } },
      { upsert: true }
    );
    return { success: true };
  } catch (error) {
    console.error("Failed to update homepage config:", error);
    throw error;
  }
}

// Function to get a section by its ID
export async function getSectionById(sectionId) {
  try {
    const config = await getHomepageConfig();
    return config.sections.find(section => section.id === sectionId) || null;
  } catch (error) {
    console.error(`Failed to get section with ID ${sectionId}:`, error);
    return null;
  }
}

// Function to export homepage config as JSON
export async function exportHomepageConfig() {
  try {
    const config = await getHomepageConfig();
    return JSON.stringify(config, null, 2);
  } catch (error) {
    console.error("Failed to export homepage config:", error);
    throw error;
  }
}

// Function to import homepage config from JSON
export async function importHomepageConfig(jsonConfig) {
  try {
    const config = typeof jsonConfig === 'string' ? JSON.parse(jsonConfig) : jsonConfig;
    return await updateHomepageConfig(config);
  } catch (error) {
    console.error("Failed to import homepage config:", error);
    throw error;
  }
} 