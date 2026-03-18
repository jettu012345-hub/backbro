import { users, teams, players, matches, collections, payments, tournaments, expenses, notifications } from "@shared/schema";
import type { User, InsertUser, Team, InsertTeam, Player, InsertPlayer, Match, InsertMatch, Collection, InsertCollection, Payment, InsertPayment, Tournament, InsertTournament, Expense, InsertExpense, Notification, InsertNotification } from "@shared/schema";
import { db } from "./db";
import { eq, and, or, sql, desc, gte, lte, ne, inArray } from "drizzle-orm";

function mapId<T extends { id: any }>(obj: T | undefined): any {
  if (!obj) return obj;
  return { ...obj, _id: obj.id.toString() };
}

function mapIds<T extends { id: any }>(objs: T[]): any[] {
  return objs.map(mapId);
}

function toNum(id: number | string): number {
  return typeof id === 'string' ? parseInt(id) : id;
}

export interface IStorage {
  // User operations
  getUser(id: number | string): Promise<any>;
  getUserByMobileNumber(mobileNumber: string): Promise<any>;
  createUser(user: InsertUser): Promise<any>;
  getUsers(): Promise<any[]>;
  getUsersByRole(role: string): Promise<any[]>;
  deleteUser(id: number | string): Promise<void>;
  updateUserStatus(id: number | string, updates: Partial<User>): Promise<any>;
  updateUserProfile(userId: number | string, updates: Partial<User>): Promise<any>;

  // Team operations
  createTeam(team: InsertTeam): Promise<any>;
  getTeam(id: number | string): Promise<any>;
  getTeams(): Promise<any[]>;
  getTeamsByAdmin(adminId: number | string): Promise<any[]>;
  updateTeam(id: number | string, updates: Partial<Team>): Promise<any>;
  deleteTeam(id: number | string): Promise<void>;
  addPlayerToTeam(teamId: number | string, userId: number | string): Promise<any>;

  // Player operations
  createPlayer(player: InsertPlayer): Promise<any>;
  getPlayerByUserId(userId: number | string): Promise<any>;
  updatePlayerProfile(userId: number | string, updates: Partial<Player>): Promise<any>;
  incrementPlayerViews(userId: number | string): Promise<void>;
  updatePlayerStats(userId: number | string, stats: any): Promise<any>;
  getPlayerDetailedStats(playerId: number | string, year?: number, opponent?: string): Promise<any>;

  // Match operations
  createMatch(match: InsertMatch): Promise<any>;
  getMatch(id: number | string): Promise<any>;
  getMatches(): Promise<any[]>;
  updateMatch(id: number | string, updates: Partial<Match>): Promise<any>;
  deleteMatch(id: number | string): Promise<void>;
  recordBall(matchId: number | string, ball: any): Promise<any>;
  updateMatchStatus(matchId: number | string, status: string): Promise<any>;
  undoBall(matchId: number | string): Promise<any>;
  endInnings(matchId: number | string): Promise<any>;
  endMatch(matchId: number | string): Promise<any>;
  getMatchYears(): Promise<number[]>;
  declareWalkover(matchId: number | string, winningTeamId: number | string, reason: string): Promise<any>;

  // Tournament operations
  createTournament(tournament: InsertTournament): Promise<any>;
  getTournament(id: number | string): Promise<any>;
  getTournaments(): Promise<any[]>;
  updateTournament(id: number | string, updates: Partial<Tournament>): Promise<any>;
  deleteTournament(id: number | string): Promise<void>;
  addTeamToTournament(tournamentId: number | string, teamId: number | string): Promise<any>;
  removeTeamFromTournament(tournamentId: number | string, teamId: number | string): Promise<any>;
  setTournamentGroups(tournamentId: string | number, groups: any[]): Promise<any>;
  setTournamentRounds(tournamentId: string | number, rounds: any[]): Promise<any>;
  generateTournamentMatches(tournamentId: number | string): Promise<any>;
  updateTournamentStandings(tournamentId: number | string): Promise<void>;
  generatePlayoffs(tournamentId: number | string): Promise<any>;
  getTournamentBracket(tournamentId: number | string): Promise<any>;
  getTournamentStats(tournamentId: number | string): Promise<any>;
  getMatchesByTournament(tournamentId: number | string, stage?: string, status?: string): Promise<any[]>;
  countMatches(tournamentId: number | string, stage?: string, statusNot?: string): Promise<number>;
  hasMatchStage(tournamentId: number | string, stages: string[]): Promise<boolean>;

  // Financial operations
  createCollection(collection: InsertCollection): Promise<any>;
  getCollection(id: number | string): Promise<any>;
  getCollectionsByTeam(teamId: number | string): Promise<any[]>;
  deleteCollection(id: number | string): Promise<void>;
  createPayment(payment: InsertPayment): Promise<any>;
  getPayment(id: number | string): Promise<any>;
  getPaymentsByCollection(collectionId: number | string): Promise<any[]>;
  getPaymentsByMember(memberId: number | string): Promise<any[]>;
  updatePaymentStatus(paymentId: number | string, status: string): Promise<any>;
  deletePayment(id: number | string): Promise<void>;
  submitPayment(paymentId: number | string, submissionData: any): Promise<any>;
  verifyPayment(paymentId: number | string, status: string, adminId: number | string): Promise<any>;
  getPendingVerifications(): Promise<any[]>;

  // Expense operations
  createExpense(expense: InsertExpense): Promise<any>;
  getExpenses(): Promise<any[]>;
  getExpensesByCollection(collectionId: number | string): Promise<any[]>;

  // Notification operations
  createNotification(notification: InsertNotification): Promise<any>;
  getNotifications(userId: number | string): Promise<any[]>;
  markNotificationRead(id: number | string): Promise<any>;

  // Other
  getLeaderboard(season?: string, opponent?: string, tournamentId?: string): Promise<any>;
  getStats(userId?: number | string, role?: string): Promise<any>;
  followUser(userId: number | string, targetUserId: number | string): Promise<any>;
  unfollowUser(userId: number | string, targetUserId: number | string): Promise<any>;
  setTournamentBroadcaster(broadcaster: (tournamentId: string, data: any) => void): void;
  wipeDatabase(): Promise<void>;
}

export class PostgresStorage implements IStorage {
  private broadcastTournamentUpdate: ((tournamentId: string, data: any) => void) | null = null;

  setTournamentBroadcaster(broadcaster: (tournamentId: string, data: any) => void): void {
    this.broadcastTournamentUpdate = broadcaster;
  }

  async getUser(id: number | string): Promise<any> {
    const nid = toNum(id);
    if (isNaN(nid)) return undefined;
    const [user] = await db.select().from(users).where(eq(users.id, nid));
    return mapId(user);
  }

  async getUserByMobileNumber(mobileNumber: string): Promise<any> {
    const [user] = await db.select().from(users).where(eq(users.mobileNumber, mobileNumber));
    return mapId(user);
  }

  async createUser(insertUser: InsertUser): Promise<any> {
    if (!insertUser.username) {
      insertUser.username = "user_" + insertUser.mobileNumber;
    }
    const [user] = await db.insert(users).values(insertUser).returning();
    return mapId(user);
  }

  async getUsers(): Promise<any[]> {
    const res = await db.select().from(users).where(ne(users.role, 'developer'));
    return mapIds(res);
  }

  async getUsersByRole(role: string): Promise<any[]> {
    const res = await db.select().from(users).where(eq(users.role, role as any));
    return mapIds(res);
  }

  async deleteUser(id: number | string): Promise<void> {
    await db.delete(users).where(eq(users.id, toNum(id)));
  }

  async updateUserStatus(id: number | string, updates: Partial<User>): Promise<any> {
    const [user] = await db.update(users).set(updates).where(eq(users.id, toNum(id))).returning();
    return mapId(user);
  }

  async updateUserProfile(userId: number | string, updates: Partial<User>): Promise<any> {
    const [user] = await db.update(users).set(updates).where(eq(users.id, toNum(userId))).returning();
    return mapId(user);
  }

  // Team operations
  async createTeam(insertTeam: InsertTeam): Promise<any> {
    const [team] = await db.insert(teams).values(insertTeam).returning();
    return mapId(team);
  }

  async getTeam(id: number | string): Promise<any> {
    const nid = toNum(id);
    if (isNaN(nid)) return undefined;
    const [team] = await db.select().from(teams).where(eq(teams.id, nid));
    return mapId(team);
  }

  async getTeams(): Promise<any[]> {
    const res = await db.select().from(teams);
    return mapIds(res);
  }

  async getTeamsByAdmin(adminId: number | string): Promise<any[]> {
    const res = await db.select().from(teams).where(eq(teams.adminId, toNum(adminId)));
    return mapIds(res);
  }

  async updateTeam(id: number | string, updates: Partial<Team>): Promise<any> {
    const [team] = await db.update(teams).set(updates).where(eq(teams.id, toNum(id))).returning();
    return mapId(team);
  }

  async deleteTeam(id: number | string): Promise<void> {
    await db.delete(teams).where(eq(teams.id, toNum(id)));
  }

  async addPlayerToTeam(teamId: number | string, userId: number | string): Promise<any> {
    const team = await this.getTeam(teamId);
    if (!team) throw new Error("Team not found");
    
    const nid = toNum(userId);
    const playersArr = Array.isArray(team.players) ? team.players : [];
    if (!playersArr.includes(nid)) {
      playersArr.push(nid);
    }

    const [updatedTeam] = await db.update(teams).set({ players: playersArr }).where(eq(teams.id, toNum(teamId))).returning();
    return mapId(updatedTeam);
  }

  // Player operations
  async createPlayer(insertPlayer: InsertPlayer): Promise<any> {
    const [player] = await db.insert(players).values(insertPlayer).returning();
    return mapId(player);
  }

  async getPlayerByUserId(userId: number | string): Promise<any> {
    const nid = toNum(userId);
    if (isNaN(nid)) return undefined;
    let [player] = await db.select().from(players).where(eq(players.userId, nid));
    if (!player) {
      const user = await this.getUser(nid);
      if (!user) return undefined;
      [player] = await db.insert(players).values({ userId: nid }).returning();
    }
    return mapId(player);
  }

  async updatePlayerProfile(userId: number | string, updates: Partial<Player>): Promise<any> {
    const nid = toNum(userId);
    const existing = await this.getPlayerByUserId(nid);
    if (!existing) {
       const [newPlayer] = await db.insert(players).values({ ...updates, userId: nid } as any).returning();
       return mapId(newPlayer);
    }
    const [player] = await db.update(players).set(updates).where(eq(players.userId, nid)).returning();
    return mapId(player);
  }

  async incrementPlayerViews(userId: number | string): Promise<void> {
    await db.update(players)
      .set({ views: sql`${players.views} + 1` })
      .where(eq(players.userId, toNum(userId)));
  }

  async updatePlayerStats(userId: number | string, stats: any): Promise<any> {
    const [player] = await db.update(players).set({ stats }).where(eq(players.userId, toNum(userId))).returning();
    return mapId(player);
  }

  async followUser(userId: number | string, targetUserId: number | string): Promise<any> {
    const nid = toNum(userId);
    const nTargetId = toNum(targetUserId);
    const user = await this.getUser(nid);
    const target = await this.getUser(nTargetId);
    if (!user || !target) throw new Error("User not found");

    const following = Array.isArray(user.following) ? user.following : [];
    if (!following.includes(nTargetId)) following.push(nTargetId);
    await db.update(users).set({ following }).where(eq(users.id, nid));

    const followers = Array.isArray(target.followers) ? target.followers : [];
    if (!followers.includes(nid)) followers.push(nid);
    const [updatedTarget] = await db.update(users).set({ followers }).where(eq(users.id, nTargetId)).returning();
    return mapId(updatedTarget);
  }

  async unfollowUser(userId: number | string, targetUserId: number | string): Promise<any> {
    const nid = toNum(userId);
    const nTargetId = toNum(targetUserId);
    const user = await this.getUser(nid);
    const target = await this.getUser(nTargetId);
    if (!user || !target) throw new Error("User not found");

    const following = (Array.isArray(user.following) ? user.following : []).filter(id => id !== nTargetId);
    await db.update(users).set({ following }).where(eq(users.id, nid));

    const followers = (Array.isArray(target.followers) ? target.followers : []).filter(id => id !== nid);
    const [updatedTarget] = await db.update(users).set({ followers }).where(eq(users.id, nTargetId)).returning();
    return mapId(updatedTarget);
  }

  // Match operations
  async createMatch(insertMatch: InsertMatch): Promise<any> {
    const [match] = await db.insert(matches).values(insertMatch).returning();
    return mapId(match);
  }

  async getMatch(id: number | string): Promise<any> {
    const nid = toNum(id);
    if (isNaN(nid)) return undefined;
    const [match] = await db.select().from(matches).where(eq(matches.id, nid));
    return mapId(match);
  }

  async getMatches(): Promise<any[]> {
    const res = await db.select().from(matches).orderBy(desc(matches.id));
    return mapIds(res);
  }

  async updateMatch(id: number | string, updates: Partial<Match>): Promise<any> {
    const [match] = await db.update(matches).set(updates).where(eq(matches.id, toNum(id))).returning();
    return mapId(match);
  }

  async deleteMatch(id: number | string): Promise<void> {
    await db.delete(matches).where(eq(matches.id, toNum(id)));
  }

  async recordBall(matchId: number | string, ball: any): Promise<any> {
    const nid = toNum(matchId);
    const match = await this.getMatch(nid);
    if (!match) throw new Error("Match not found");

    const ballsArr = Array.isArray(match.balls) ? match.balls : [];
    ballsArr.push(ball);

    const [updatedMatch] = await db.update(matches).set({ balls: ballsArr }).where(eq(matches.id, nid)).returning();
    await this.updateStatsAfterBall(updatedMatch, ball);
    return mapId(updatedMatch);
  }

  private async updateStatsAfterBall(match: Match, ball: any): Promise<void> {
    const { batsman, bowler, runs, extra, wicket, wicketType } = ball;
    const batsmanId = toNum(typeof batsman === 'object' ? (batsman.id || batsman._id) : batsman);
    const bowlerId = toNum(typeof bowler === 'object' ? (bowler.id || bowler._id) : bowler);

    if (batsmanId) {
      const isWide = extra === 'wide';
      const runsScored = runs || 0;
      
      const player = await this.getPlayerByUserId(batsmanId);
      if (player) {
        const stats = player.stats as any;
        stats.batting.runs += runsScored;
        if (!isWide) stats.batting.ballsFaced += 1;
        if (runsScored === 4) stats.batting.fours += 1;
        if (runsScored === 6) stats.batting.sixes += 1;
        
        if (stats.batting.ballsFaced > 0) {
          stats.batting.strikeRate = (stats.batting.runs / stats.batting.ballsFaced) * 100;
        }
        
        await this.updatePlayerStats(batsmanId, stats);
      }
    }

    if (bowlerId) {
      const dismissalType = (wicketType || wicket || "").toLowerCase();
      const bowlerWicketTypes = ['bowled', 'caught', 'lbw', 'stumped', 'hit wicket', 'out'];
      const isWicket = !!wicket && bowlerWicketTypes.includes(dismissalType);
      
      const isExtra = ['wide', 'noball'].includes(extra);
      const runsConceded = (runs || 0) + (isExtra ? 1 : 0);
      
      const player = await this.getPlayerByUserId(bowlerId);
      if (player) {
        const stats = player.stats as any;
        if (isWicket) stats.bowling.wickets += 1;
        stats.bowling.runsConceded += runsConceded;
        await this.updatePlayerStats(bowlerId, stats);
      }
    }
  }

  async updateMatchStatus(matchId: number | string, status: string): Promise<any> {
    const [match] = await db.update(matches).set({ status: status as any }).where(eq(matches.id, toNum(matchId))).returning();
    return mapId(match);
  }

  async undoBall(matchId: number | string): Promise<any> {
    const nid = toNum(matchId);
    const match = await this.getMatch(nid);
    if (!match || !Array.isArray(match.balls) || match.balls.length === 0) return match!;

    const ballsArr = [...match.balls];
    const ballToUndo = ballsArr.pop();
    
    const updates: any = { balls: ballsArr };
    if (match.status === 'completed') {
      updates.status = 'live';
      updates.result = '';
    }

    const [updatedMatch] = await db.update(matches).set(updates).where(eq(matches.id, nid)).returning();
    if (ballToUndo) {
      await this.revertStatsFromBall(updatedMatch, ballToUndo);
    }
    return mapId(updatedMatch);
  }

  private async revertStatsFromBall(match: Match, ball: any): Promise<void> {
    const { batsman, bowler, runs, extra, wicket } = ball;
    const batsmanId = toNum(typeof batsman === 'object' ? (batsman.id || batsman._id) : batsman);
    const bowlerId = toNum(typeof bowler === 'object' ? (bowler.id || bowler._id) : bowler);

    if (batsmanId) {
      const isWide = extra === 'wide';
      const runsScored = runs || 0;
      const player = await this.getPlayerByUserId(batsmanId);
      if (player) {
        const stats = player.stats as any;
        stats.batting.runs -= runsScored;
        if (!isWide) stats.batting.ballsFaced -= 1;
        if (runsScored === 4) stats.batting.fours -= 1;
        if (runsScored === 6) stats.batting.sixes -= 1;
        
        if (stats.batting.ballsFaced > 0) {
          stats.batting.strikeRate = (stats.batting.runs / stats.batting.ballsFaced) * 100;
        } else {
          stats.batting.strikeRate = 0;
        }
        await this.updatePlayerStats(batsmanId, stats);
      }
    }

    if (bowlerId) {
      const isWicket = !!wicket && !['runout', 'retired hurt', 'obstructing the field', 'hit the ball twice'].includes(wicket.toLowerCase());
      const isExtra = ['wide', 'noball'].includes(extra);
      const runsConceded = (runs || 0) + (isExtra ? 1 : 0);
      
      const player = await this.getPlayerByUserId(bowlerId);
      if (player) {
        const stats = player.stats as any;
        if (isWicket) stats.bowling.wickets -= 1;
        stats.bowling.runsConceded -= runsConceded;
        await this.updatePlayerStats(bowlerId, stats);
      }
    }
  }

  async endInnings(matchId: number | string): Promise<any> {
    const nid = toNum(matchId);
    const match = await this.getMatch(nid);
    if (!match) throw new Error("Match not found");

    const currentInnings = match.innings || 1;
    const balls = Array.isArray(match.balls) ? match.balls : [];
    const inningsBalls = balls.filter((b: any) => b.innings === currentInnings);
    const totalRuns = inningsBalls.reduce((acc: number, b: any) => acc + (b.runs || 0) + (['wide', 'noball'].includes(b.extra) ? 1 : 0), 0);

    if (currentInnings === 1) {
      const target = totalRuns + 1;
      return await this.updateMatch(nid, {
        innings: 2,
        target,
        battingTeam: match.bowlingTeam,
        bowlingTeam: match.battingTeam,
        striker: null,
        nonStriker: null,
        currentBowler: null
      });
    } else {
      const target = match.target || 0;
      let result = "";
      let winnerId = null;

      if (totalRuns >= target) {
        winnerId = match.battingTeam;
        result = "Batting team won";
      } else {
        winnerId = match.bowlingTeam;
        result = "Bowling team won";
      }

      return await this.updateMatch(nid, {
        result,
        winner: winnerId
      });
    }
  }

  async endMatch(matchId: number | string): Promise<any> {
    const nid = toNum(matchId);
    const match = await this.getMatch(nid);
    if (!match) throw new Error("Match not found");

    const updatedMatch = await this.updateMatch(nid, {
      status: 'completed',
    });

    await this.calculateManOfTheMatch(nid);
    await this.calculateBestPartnership(nid);

    const playerIds = Array.isArray(match.playingXIA) && Array.isArray(match.playingXIB) ? [...match.playingXIA, ...match.playingXIB] : [];
    for (const pid of playerIds) {
      await this.recalculatePlayerStats(pid);
    }
    
    if (match.teamA) await this.recalculateTeamStats(match.teamA);
    if (match.teamB) await this.recalculateTeamStats(match.teamB);

    if (updatedMatch.tournamentId) {
      await this.updateTournamentStandings(updatedMatch.tournamentId);
    }

    return mapId(updatedMatch);
  }

  async getMatchYears(): Promise<number[]> {
    const res = await db.select({ date: matches.date }).from(matches).where(eq(matches.status, 'completed'));
    const years = new Set(res.map(m => new Date(m.date).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }

  async declareWalkover(matchId: number | string, winningTeamId: number | string, reason: string): Promise<any> {
    const nid = toNum(matchId);
    const [match] = await db.update(matches)
      .set({ 
        status: 'walkover',
        winner: toNum(winningTeamId),
        result: `Won by Walkover (${reason})`
      })
      .where(eq(matches.id, nid))
      .returning();
    
    if (match.tournamentId) {
      await this.updateTournamentStandings(match.tournamentId);
    }
    return mapId(match);
  }

  // Tournament operations
  async createTournament(insertTournament: InsertTournament): Promise<any> {
    const [tournament] = await db.insert(tournaments).values(insertTournament).returning();
    return mapId(tournament);
  }

  async getTournament(id: number | string): Promise<any> {
    const nid = toNum(id);
    if (isNaN(nid)) return undefined;
    const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, nid));
    return mapId(tournament);
  }

  async getTournaments(): Promise<any[]> {
    const res = await db.select().from(tournaments);
    return mapIds(res);
  }

  async updateTournament(id: number | string, updates: Partial<Tournament>): Promise<any> {
    const [tournament] = await db.update(tournaments).set(updates).where(eq(tournaments.id, toNum(id))).returning();
    return mapId(tournament);
  }

  async deleteTournament(id: number | string): Promise<void> {
    await db.delete(tournaments).where(eq(tournaments.id, toNum(id)));
  }

  async addTeamToTournament(tournamentId: number | string, teamId: number | string): Promise<any> {
    const nTid = toNum(tournamentId);
    const nTeamId = toNum(teamId);
    const tournament = await this.getTournament(nTid);
    if (!tournament) throw new Error("Tournament not found");
    const teamsArr = Array.isArray(tournament.teams) ? tournament.teams : [];
    if (!teamsArr.includes(nTeamId)) teamsArr.push(nTeamId);
    const [updated] = await db.update(tournaments).set({ teams: teamsArr }).where(eq(tournaments.id, nTid)).returning();
    return mapId(updated);
  }

  async removeTeamFromTournament(tournamentId: number | string, teamId: number | string): Promise<any> {
    const nTid = toNum(tournamentId);
    const nTeamId = toNum(teamId);
    const tournament = await this.getTournament(nTid);
    if (!tournament) throw new Error("Tournament not found");
    const teamsArr = (Array.isArray(tournament.teams) ? tournament.teams : []).filter(id => id !== nTeamId);
    const [updated] = await db.update(tournaments).set({ teams: teamsArr }).where(eq(tournaments.id, nTid)).returning();
    return mapId(updated);
  }

  async setTournamentGroups(tournamentId: string | number, groups: any[]): Promise<any> {
    const nid = toNum(tournamentId);
    const [updated] = await db.update(tournaments).set({ groups }).where(eq(tournaments.id, nid)).returning();
    return mapId(updated);
  }

  async setTournamentRounds(tournamentId: string | number, rounds: any[]): Promise<any> {
    const nid = toNum(tournamentId);
    const [updated] = await db.update(tournaments).set({ rounds }).where(eq(tournaments.id, nid)).returning();
    return mapId(updated);
  }

  async generateTournamentMatches(tournamentId: number | string): Promise<any> {
    const nid = toNum(tournamentId);
    const tournament = await this.getTournament(nid);
    if (!tournament) throw new Error("Tournament not found");

    const teamsArr = Array.isArray(tournament.teams) ? tournament.teams : [];
    const matchups: any[] = [];
    for (let i = 0; i < teamsArr.length; i++) {
      for (let j = i + 1; j < teamsArr.length; j++) {
        matchups.push({ teamA: teamsArr[i], teamB: teamsArr[j] });
      }
    }

    if (matchups.length > 0) {
      const matchesToCreate = matchups.map((m, idx) => ({
        teamA: m.teamA,
        teamB: m.teamB,
        status: 'upcoming' as any,
        overs: tournament.oversPerMatch || 20,
        tournamentId: nid,
        stage: 'league' as any,
        matchNumber: idx + 1
      }));
      const createdMatches = await db.insert(matches).values(matchesToCreate).returning();
      const matchIds = createdMatches.map(m => m.id);
      const [updated] = await db.update(tournaments).set({ matches: matchIds, currentStep: 'MATCHES' }).where(eq(tournaments.id, nid)).returning();
      return mapId(updated);
    }
    return tournament;
  }

  async updateTournamentStandings(tournamentId: number | string): Promise<void> {
    const nid = toNum(tournamentId);
    const tournament = await this.getTournament(nid);
    if (!tournament) return;

    const allMatches = await db.select().from(matches).where(eq(matches.tournamentId, nid));
    const completedMatches = allMatches.filter(m => m.status === 'completed' || m.status === 'walkover');

    const teamStatsMap = new Map<number, any>();
    const teamsArr = Array.isArray(tournament.teams) ? tournament.teams : [];
    for (const tid of teamsArr) {
      teamStatsMap.set(tid, { teamId: tid, played: 0, won: 0, lost: 0, pts: 0, nrr: 0 });
    }

    for (const match of completedMatches) {
      const statsA = teamStatsMap.get(match.teamA);
      const statsB = teamStatsMap.get(match.teamB);
      if (!statsA || !statsB) continue;

      statsA.played++;
      statsB.played++;
      if (match.winner) {
        if (match.winner === match.teamA) {
          statsA.won++;
          statsA.pts += 2;
          statsB.lost++;
        } else {
          statsB.won++;
          statsB.pts += 2;
          statsA.lost++;
        }
      }
    }
    const standings = Array.from(teamStatsMap.values());
    await db.update(tournaments).set({ standings }).where(eq(tournaments.id, nid));
    if (this.broadcastTournamentUpdate) {
      this.broadcastTournamentUpdate(nid.toString(), { type: 'standings-update', standings });
    }
  }

  async generatePlayoffs(tournamentId: number | string): Promise<any> {
    return null;
  }

  async getTournamentBracket(tournamentId: number | string): Promise<any> {
    const nid = toNum(tournamentId);
    const allMatches = await db.select().from(matches).where(eq(matches.tournamentId, nid));
    return {
      quarterFinals: mapIds(allMatches.filter(m => m.stage === 'quarterfinal')),
      semiFinals: mapIds(allMatches.filter(m => m.stage === 'semifinal')),
      final: mapId(allMatches.find(m => m.stage === 'final'))
    };
  }

  async getTournamentStats(tournamentId: number | string): Promise<any> {
    const nid = toNum(tournamentId);
    const tournament = await this.getTournament(nid);
    if (!tournament) return null;
    const leaderboard = await this.getLeaderboard('all', 'all', nid.toString());
    return { overview: {}, topPerformers: leaderboard, teamPerformance: tournament.standings || [], charts: {} };
  }

  async getMatchesByTournament(tournamentId: number | string, stage?: string, status?: string): Promise<any[]> {
    const nid = toNum(tournamentId);
    let query = db.select().from(matches).where(eq(matches.tournamentId, nid));
    if (stage) query = query.where(eq(matches.stage, stage as any)) as any;
    if (status) query = query.where(eq(matches.status, status as any)) as any;
    const res = await query;
    return mapIds(res);
  }

  async countMatches(tournamentId: number | string, stage?: string, statusNot?: string): Promise<number> {
    const nid = toNum(tournamentId);
    let conditions = [eq(matches.tournamentId, nid)];
    if (stage) conditions.push(eq(matches.stage, stage as any));
    if (statusNot) conditions.push(ne(matches.status, statusNot as any));
    const res = await db.select({ count: sql`count(*)` }).from(matches).where(and(...conditions));
    return Number(res[0].count);
  }

  async hasMatchStage(tournamentId: number | string, stages: string[]): Promise<boolean> {
    const nid = toNum(tournamentId);
    const res = await db.select({ count: sql`count(*)` }).from(matches).where(and(eq(matches.tournamentId, nid), inArray(matches.stage, stages as any)));
    return Number(res[0].count) > 0;
  }

  // Financial operations
  async createCollection(insertCollection: InsertCollection): Promise<any> {
    const [collection] = await db.insert(collections).values(insertCollection).returning();
    return mapId(collection);
  }

  async getCollection(id: number | string): Promise<any> {
    const nid = toNum(id);
    if (isNaN(nid)) return undefined;
    const [collection] = await db.select().from(collections).where(eq(collections.id, nid));
    return mapId(collection);
  }

  async getCollectionsByTeam(teamId: number | string): Promise<any[]> {
    const res = await db.select().from(collections).where(eq(collections.teamId, toNum(teamId)));
    return mapIds(res);
  }

  async deleteCollection(id: number | string): Promise<void> {
    await db.delete(collections).where(eq(collections.id, toNum(id)));
  }

  async createPayment(insertPayment: InsertPayment): Promise<any> {
    const [payment] = await db.insert(payments).values(insertPayment).returning();
    return mapId(payment);
  }

  async getPayment(id: number | string): Promise<any> {
    const nid = toNum(id);
    if (isNaN(nid)) return undefined;
    const [payment] = await db.select().from(payments).where(eq(payments.id, nid));
    return mapId(payment);
  }

  async getPaymentsByCollection(collectionId: number | string): Promise<any[]> {
    const res = await db.select().from(payments).where(eq(payments.collectionId, toNum(collectionId)));
    return mapIds(res);
  }

  async getPaymentsByMember(memberId: number | string): Promise<any[]> {
    const res = await db.select().from(payments).where(eq(payments.memberId, toNum(memberId)));
    return mapIds(res);
  }

  async updatePaymentStatus(paymentId: number | string, status: string): Promise<any> {
    const [payment] = await db.update(payments).set({ status: status as any }).where(eq(payments.id, toNum(paymentId))).returning();
    return mapId(payment);
  }

  async deletePayment(id: number | string): Promise<void> {
    await db.delete(payments).where(eq(payments.id, toNum(id)));
  }

  async submitPayment(paymentId: number | string, submissionData: any): Promise<any> {
    const [payment] = await db.update(payments)
      .set({ ...submissionData, status: 'verification_pending', submittedAt: new Date() })
      .where(eq(payments.id, toNum(paymentId)))
      .returning();
    return mapId(payment);
  }

  async verifyPayment(paymentId: number | string, status: string, adminId: number | string): Promise<any> {
    const [payment] = await db.update(payments)
      .set({ status: status as any, verifiedBy: toNum(adminId), verifiedAt: new Date() })
      .where(eq(payments.id, toNum(paymentId)))
      .returning();
    return mapId(payment);
  }

  async getPendingVerifications(): Promise<any[]> {
    const res = await db.select().from(payments).where(eq(payments.status, 'verification_pending'));
    return mapIds(res);
  }

  // Expense operations
  async createExpense(insertExpense: InsertExpense): Promise<any> {
    const [expense] = await db.insert(expenses).values(insertExpense).returning();
    return mapId(expense);
  }

  async getExpenses(): Promise<any[]> {
    const res = await db.select().from(expenses).orderBy(desc(expenses.date));
    return mapIds(res);
  }

  async getExpensesByCollection(collectionId: number | string): Promise<any[]> {
    const res = await db.select().from(expenses).where(eq(expenses.collectionId, toNum(collectionId)));
    return mapIds(res);
  }

  // Notification operations
  async createNotification(insertNotification: InsertNotification): Promise<any> {
    const [notification] = await db.insert(notifications).values(insertNotification).returning();
    return mapId(notification);
  }

  async getNotifications(userId: number | string): Promise<any[]> {
    const res = await db.select().from(notifications).where(eq(notifications.userId, toNum(userId))).orderBy(desc(notifications.createdAt)).limit(20);
    return mapIds(res);
  }

  async markNotificationRead(id: number | string): Promise<any> {
    const [notification] = await db.update(notifications).set({ read: true }).where(eq(notifications.id, toNum(id))).returning();
    return mapId(notification);
  }

  // Analytics & Leaderboard
  async getLeaderboard(season?: string, opponent?: string, tournamentId?: string): Promise<any> {
    return { orangeCap: [], purpleCap: [], mostSixes: [], mostFours: [], highestStrikeRate: [], bestEconomy: [], bestBowlingFigures: [] };
  }

  async getStats(userId?: number | string, role?: string): Promise<any> {
    const teamCountRes = await db.select({ count: sql`count(*)` }).from(teams);
    const playerCountRes = await db.select({ count: sql`count(*)` }).from(users).where(ne(users.role, 'public'));
    const matchCountRes = await db.select({ count: sql`count(*)` }).from(matches);
    
    return { 
      totalTeams: Number(teamCountRes[0].count), 
      totalPlayers: Number(playerCountRes[0].count), 
      totalMatches: Number(matchCountRes[0].count), 
      recentMatches: [], 
      pendingPayments: [] 
    };
  }

  async getPlayerDetailedStats(playerId: number | string, year?: number, opponent?: string): Promise<any> {
    return null;
  }

  async calculateManOfTheMatch(matchId: number | string): Promise<any> { return null; }
  async calculateBestPartnership(matchId: number | string): Promise<any> { return null; }

  private async recalculatePlayerStats(userId: number | string): Promise<void> {}
  private async recalculateTeamStats(teamId: number | string): Promise<void> {}

  async wipeDatabase(): Promise<void> {
    await db.delete(payments);
    await db.delete(expenses);
    await db.delete(collections);
    await db.delete(matches);
    await db.delete(players);
    await db.delete(teams);
    await db.delete(notifications);
  }
}

export const storage = new PostgresStorage();
