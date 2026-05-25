export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Local email/password login page. Unauthenticated users are sent here
// instead of an external OAuth portal.
export const getLoginUrl = () => "/login";
