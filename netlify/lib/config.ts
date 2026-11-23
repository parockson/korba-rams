export const ORG_TZ = () => process.env.ORG_TIMEZONE || "Africa/Accra";
export const MAX_UPLOAD_BYTES = () => Math.floor(Number(process.env.MAX_UPLOAD_MB || 4) * 1024 * 1024);
export const MAX_ROWS = () => Number(process.env.MAX_ROWS || 50000);
export const MAX_EXPORT_ROWS = 100000;
