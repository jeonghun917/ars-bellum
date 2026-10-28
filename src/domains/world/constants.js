// Distances are in world pixels (the map is 4096 x 4096), speeds in pixels per second.

// A group closer than this to its final target has arrived (Campaign.js used 2).
export const ARRIVE_DISTANCE = 2;
// A route moves on to the next bend once the group is this close to the current one (W_Routes reachDistance).
export const WAYPOINT_REACH = 8;
// A point counts as "on the road" this far from the road's centre line (W_Map roadHalfWidth).
export const ROAD_HALF_WIDTH = 34;
// A group plans along roads only from a settlement with a road that is at most this far away.
export const ROUTE_START_SEARCH = 420;
// A road route more than this many times longer than the straight line is not worth taking.
export const MAX_DETOUR_RATIO = 2.25;
// While moving, the terrain is looked at every this many pixels, so a thin river cannot be jumped
// over by a long step. The smallest zone in the data is 80 pixels wide.
export const SAMPLE_DISTANCE = 8;
// Upper bound on samples in one step: far more than the map is wide, so it only guards bad input.
export const MAX_SAMPLES_PER_STEP = 4096;
// Costs that differ by less than this are ties.
export const COST_EPSILON = 1e-9;
