/**
 * Simple in-memory store for tracking feedback history.
 */
export class FeedbackStore {
    private entries: string[] = [];

    public add(text: string): void {
        this.entries.push(text);
    }

    public clear(): void {
        this.entries = [];
    }
}
