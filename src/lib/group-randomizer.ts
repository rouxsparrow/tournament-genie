type GroupBucket = {
  id: string;
  teamIds: string[];
};

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function buildRandomizedGroups(params: {
  groupIds: string[];
  seedTeamIds: string[];
  nonSeedTeamIds: string[];
}) {
  const buckets: GroupBucket[] = params.groupIds.map((id) => ({
    id,
    teamIds: [],
  }));

  const seeds = shuffle(params.seedTeamIds);
  const nonSeeds = shuffle(params.nonSeedTeamIds);

  seeds.forEach((teamId, index) => {
    const bucket = buckets[index % buckets.length];
    bucket.teamIds.push(teamId);
  });

  nonSeeds.forEach((teamId, index) => {
    const bucket = buckets[index % buckets.length];
    bucket.teamIds.push(teamId);
  });

  return buckets;
}
