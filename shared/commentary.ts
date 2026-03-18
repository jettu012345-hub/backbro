export function generateCommentary(ball: {
  batsmanName: string;
  bowlerName: string;
  runs: number;
  shotDirection?: string;
  boundaryType?: string;
  extra?: string;
  wicket?: string;
  wicketType?: string;
}): string {
  const { batsmanName, bowlerName, runs, shotDirection, boundaryType, extra, wicket, wicketType } = ball;

  if (wicket) {
    if (wicketType === 'bowled') return `BOWLED! ${bowlerName} shatters the stumps. ${batsmanName} is gone.`;
    if (wicketType === 'caught') return `OUT! ${batsmanName} hits it towards ${shotDirection || 'the fielder'} but it's caught.`;
    if (wicketType === 'lbw') return `Appeal... given! ${batsmanName} trapped LBW by ${bowlerName}.`;
    if (wicketType === 'run out') return `RUN OUT! Direct hit and ${batsmanName} is short of the crease.`;
    return `OUT! ${batsmanName} is dismissed (${wicketType}).`;
  }

  if (extra) {
    if (extra === 'wide') return `Wide ball from ${bowlerName}.`;
    if (extra === 'noball') return `No ball from ${bowlerName}. Free hit coming up.`;
    if (extra === 'bye') return `The ball goes past the batsman. They take a bye.`;
    if (extra === 'legbye') return `Deflects off the pads and they collect a leg bye.`;
  }

  if (runs === 0) return `No run. Good delivery by ${bowlerName}, defended by ${batsmanName}.`;
  if (runs === 4) return `FOUR! ${batsmanName} plays a brilliant shot through ${shotDirection || 'the gap'}.`;
  if (runs === 6) return `SIX! ${batsmanName} launches it over ${shotDirection || 'the boundary'} for a massive six.`;
  if (runs === 1) return `${batsmanName} pushes it towards ${shotDirection || 'the fielder'} and takes a quick single.`;
  if (runs === 2) return `${batsmanName} drives it towards ${shotDirection || 'the deep'}. They come back for two.`;
  if (runs === 3) return `Beautiful placement by ${batsmanName} into the ${shotDirection || 'field'}. They run three.`;

  return `${batsmanName} scores ${runs} run(s) towards ${shotDirection || 'the field'}.`;
}
