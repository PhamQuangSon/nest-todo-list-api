// Counts every time a subsystem chose to degrade instead of fail. Failing open
// is only safe if someone finds out — these are what an alert fires on, since
// the user-visible symptom is precisely that nothing looks wrong.
export const degradation = {
  rateLimiterFailOpen: 0,
  loginGuardFailOpen: 0,
  cacheBypass: 0,
};
