import { emit } from "@tauri-apps/api/event";

export type User = {
    $id: string;
    $createdAt: string;
    $updatedAt: string;
    name: string;
    email: string;
    labels: string[];
    prefs: Record<string, unknown>;
};

export type Session = {
    $id: string;
    current: boolean;
    osName: string;
    clientName: string;
    countryName: string;
};

export type SessionList = {
    total: number;
    sessions: Session[];
};

export type Jwt = {
    jwt: string;
};

function emitAuthChanged() {
    emit("auth:changed").catch(() => { });
}

function cloudDisabledError() {
    return new Error("Cloud account features are currently unavailable.");
}

export async function createAccount(
    _email: string,
    _password: string,
    _name?: string
): Promise<User> {
    throw cloudDisabledError();
}

export async function logout(): Promise<void> {
    emitAuthChanged();
}

export async function logoutAll(): Promise<void> {
    emitAuthChanged();
}

export async function getCurrentUser(): Promise<User | null> {
    return null;
}

export async function createJwt(): Promise<Jwt> {
    throw cloudDisabledError();
}

export async function updateName(_name: string): Promise<User> {
    throw cloudDisabledError();
}

export async function updatePassword(
    _newPassword: string,
    _oldPassword: string
): Promise<User> {
    throw cloudDisabledError();
}

export async function listSessions(): Promise<SessionList> {
    return {
        total: 0,
        sessions: [],
    };
}

export async function deleteSessionById(_sessionId: string): Promise<void> {
}
