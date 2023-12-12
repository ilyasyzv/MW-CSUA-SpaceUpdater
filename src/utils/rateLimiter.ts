export class RateLimiter {
    private queue: Function[] = [];
    private isProcessing = false;
    private limit: number;
    private delay: number;

    constructor(limit: number, delay: number) {
        this.limit = limit;
        this.delay = delay;
    }

    public async addToQueue(rateLimiter: Function): Promise<void> {
        return new Promise<void>((resolve) => {
            this.queue.push(async () => {
                await rateLimiter();
                resolve();
            });
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    private async processQueue(): Promise<void> {
        if (!this.isProcessing) {
            this.isProcessing = true;
            while (this.queue.length > 0) {
                const tasksToProcess = this.queue.splice(0, this.limit);
                await Promise.all(tasksToProcess.map(async (task) => {
                    await task();
                }));
                await this.sleep(this.delay);
            }
            this.isProcessing = false;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise<void>((resolve) => setTimeout(resolve, ms));
    }
}