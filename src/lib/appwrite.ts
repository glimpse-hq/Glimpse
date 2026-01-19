import { Client, Account, Databases } from "appwrite";

export const client = new Client();

const appwriteEndpoint = import.meta.env.VITE_APPWRITE_ENDPOINT;
const appwriteProjectId = import.meta.env.VITE_APPWRITE_PROJECT_ID;

if (appwriteEndpoint && appwriteProjectId) {
    client.setEndpoint(appwriteEndpoint).setProject(appwriteProjectId);
} else {
    console.warn(
        "Appwrite not configured: missing VITE_APPWRITE_ENDPOINT or VITE_APPWRITE_PROJECT_ID"
    );
}

export const account = new Account(client);
export const databases = new Databases(client);

export { ID, Query, Permission, Role, type Models } from "appwrite";
