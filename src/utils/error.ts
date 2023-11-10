export const errorHandler = (error: Error): void => {
    console.error(error);
    // I think we need some kind of logger to control errors
    // Maybe sentry.
};
