import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import type { Match } from "@shared/schema";
import { generateCommentary } from "@shared/commentary";
import { WebSocketServer, WebSocket } from "ws";

export let broadcastMatchUpdate: (matchId: string, data: any) => void;
export let broadcastTournamentUpdate: (tournamentId: string, data: any) => void;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  broadcastMatchUpdate = (matchId: string, data: any) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && (client as any).matchId === matchId) {
        client.send(JSON.stringify({ type: "match-update", data }));
      }
    });
  };

  broadcastTournamentUpdate = (tournamentId: string, data: any) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && (client as any).tournamentId === tournamentId) {
        client.send(JSON.stringify({ type: "tournament-update", data }));
      }
    });
  };

  storage.setTournamentBroadcaster(broadcastTournamentUpdate);

  wss.on("connection", (ws) => {
    ws.on("message", (message) => {
      try {
        const { type, matchId, tournamentId, userId } = JSON.parse(message.toString());
        if (type === "join-match") {
          (ws as any).matchId = matchId;
        } else if (type === "join-tournament") {
          (ws as any).tournamentId = tournamentId;
        } else if (type === "join-user") {
          (ws as any).userId = userId;
        }
      } catch (e) {
        console.error("WS parse error", e);
      }
    });
  });

  const broadcastUserDeactivation = (userId: string) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && (client as any).userId === userId) {
        client.send(JSON.stringify({ type: "account-deactivated" }));
      }
    });
  };

  // Status check middleware
  app.use("/api", async (req, res, next) => {
    if (req.path.startsWith("/auth/login") || req.path.startsWith("/auth/register")) {
      return next();
    }
    
    const userId = req.headers["x-user-id"] as string;
    if (userId) {
      const user = await storage.getUser(userId);
      if (user) {
        if (user.role !== 'public' && user.role !== 'developer') {
          if (!user.isApproved || !user.isActive) {
             return res.status(403).json({ message: "Sorry, your account has been deactivated." });
          }
        }
      }
    }
    next();
  });

  // Auth Routes
  app.post("/api/auth/register", async (req, res) => {
    const { fullName, mobileNumber, password, email, role, isApproved, playingRole, battingStyle, bowlingStyle } = req.body;
    
    // Validate 10-digit mobile number
    if (!/^\d{10}$/.test(mobileNumber)) {
      return res.status(400).json({ message: "Mobile number must be exactly 10 digits." });
    }

    const existing = await storage.getUserByMobileNumber(mobileNumber);
    if (existing) {
      return res.status(400).json({ message: "Sorry, you have already registered with this mobile number." });
    }

    const user = await storage.createUser({ 
      fullName, 
      mobileNumber, 
      password: password || "password", 
      email, 
      role: role || 'player',
      isApproved: isApproved !== undefined ? isApproved : false, // Default to pending
      isActive: true
    });

    if (user.role === 'player' || user.role === 'captain') {
      await storage.createPlayer({
        userId: user._id,
        playingRole: playingRole || 'Batsman',
        battingStyle: battingStyle || 'Right-hand bat',
        bowlingStyle: bowlingStyle || 'Right-arm fast'
      });
    }

    res.status(201).json(user);
  });

  app.post("/api/auth/login", async (req, res) => {
    const { mobileNumber, password } = req.body;
    
    const user = await storage.getUserByMobileNumber(mobileNumber);
    if (!user) {
      // Allow DEVILUPPER login even if it doesn't match numeric pattern (since it's seeded)
      if (mobileNumber === 'DEVILUPPER') {
         // This block shouldn't be reached if it was found above, 
         // but we keep the logic clean.
      }
      return res.status(401).json({ message: "Sorry, you have need to registered with this mobile number." });
    }

    // Role-based password override for public
    const effectivePassword = user.role === 'public' ? 'public' : (password || "password");

    if (user.password !== effectivePassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    
    // Access Control Check
    if (user.role !== 'public') {
      if (!user.isApproved) {
        return res.status(403).json({ message: "Your account is waiting for developer approval." });
      }
      if (!user.isActive) {
        return res.status(403).json({ message: "Access denied. Your account has been disabled." });
      }
    }

    res.json({
      ...user.toObject ? user.toObject() : user,
      welcomeMessage: `Welcome@${user.fullName}.`
    });
  });

  app.get("/api/users", async (req, res) => {
    const users = await storage.getUsers();
    res.json(users);
  });

  app.get("/api/users/:id", async (req, res) => {
    const user = await storage.getUser(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  });

  app.post("/api/contact", async (req, res) => {
    const { name, email, role, subject, message } = req.body;
    
    // Find all users with 'developer' role
    const developers = await storage.getUsersByRole('developer');
    
    if (developers.length > 0) {
      for (const dev of developers) {
        await storage.createNotification({
          userId: dev._id.toString(),
          title: `Contact Form: ${subject}`,
          message: `New message from ${name} (${role}): ${message}. Contact: ${email}`,
          type: 'system'
        });
      }
    }
    
    res.status(200).json({ success: true, message: "Thank you for contacting us. Our team will respond soon." });
  });

  app.patch("/api/users/:id/status", async (req, res) => {
    const user = await storage.updateUserStatus(req.params.id, req.body);
    
    // If user is deactivated or unapproved, broadcast to force logout
    if (user && (user.isApproved === false || user.isActive === false)) {
      if (user.role !== 'developer' && user.role !== 'admin') {
        broadcastUserDeactivation(user._id.toString());
      }
    }
    
    res.json(user);
  });

  app.delete("/api/users/:id", async (req, res) => {
    // Basic delete
    const result = await (storage as any).deleteUser(req.params.id);
    res.json({ success: !!result });
  });

  app.delete("/api/teams/:id", async (req, res) => {
    const result = await (storage as any).deleteTeam(req.params.id);
    res.json({ success: !!result });
  });

  app.delete("/api/matches/:id", async (req, res) => {
    const result = await (storage as any).deleteMatch(req.params.id);
    res.json({ success: !!result });
  });

  app.delete("/api/tournaments/:id", async (req, res) => {
    const result = await (storage as any).deleteTournament(req.params.id);
    res.json({ success: !!result });
  });

  app.delete("/api/collections/:id", async (req, res) => {
    const result = await (storage as any).deleteCollection(req.params.id);
    res.json({ success: !!result });
  });

  app.delete("/api/payments/:id", async (req, res) => {
    const result = await (storage as any).deletePayment(req.params.id);
    res.json({ success: !!result });
  });

  // Team & Player Routes
  app.post("/api/teams", async (req, res) => {
    const team = await storage.createTeam(req.body);
    res.status(201).json(team);
  });

  app.get("/api/teams", async (req, res) => {
    const teams = await storage.getTeams();
    res.json(teams);
  });

  app.get("/api/teams/:id", async (req, res) => {
    const team = await storage.getTeam(req.params.id);
    if (!team) return res.status(404).json({ message: "Team not found" });
    res.json(team);
  });

  app.patch("/api/teams/:id/scorer", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const { scorerId } = req.body;
    
    const user = await storage.getUser(userId);
    const team = await storage.getTeam(req.params.id);
    if (!team) return res.status(404).json({ message: "Team not found" });

    const isDeveloper = user && user.role === 'developer';
    const isAdmin = user && user.role === 'admin';
    const isTeamAdmin = team.adminId && (
      (team.adminId._id && team.adminId._id.toString() === userId) || 
      (team.adminId.toString() === userId)
    );

    if (!isDeveloper && !isAdmin && !isTeamAdmin) {
      return res.status(403).json({ message: "Only Admins or the Team Captain can assign team scorers" });
    }

    const updatedTeam = await storage.updateTeam(req.params.id, { scorerId });
    res.json(updatedTeam);
  });

  app.post("/api/teams/:id/players", async (req, res) => {
    const { userId } = req.body;
    const team = await storage.addPlayerToTeam(req.params.id, userId);
    res.json(team);
  });

  app.get("/api/players/:userId", async (req, res) => {
    const player = await storage.getPlayerByUserId(req.params.userId);
    res.json(player);
  });

  app.patch("/api/players/:userId/profile", async (req, res) => {
    const { 
      fullName, 
      username, 
      profileImage, 
      email, 
      mobileNumber, 
      location, 
      playingRole, 
      battingStyle, 
      bowlingStyle, 
      dob, 
      gender 
    } = req.body;
    const userId = req.params.userId;

    const userUpdates: any = {};
    if (fullName !== undefined) userUpdates.fullName = fullName;
    if (username !== undefined) userUpdates.username = username;
    if (profileImage !== undefined) userUpdates.profileImage = profileImage;
    if (email !== undefined) userUpdates.email = email;
    if (mobileNumber !== undefined) userUpdates.mobileNumber = mobileNumber;

    if (Object.keys(userUpdates).length > 0) {
      await storage.updateUserProfile(userId, userUpdates);
    }

    const playerUpdates: any = {};
    if (location !== undefined) playerUpdates.location = location;
    if (playingRole !== undefined) playerUpdates.playingRole = playingRole;
    if (battingStyle !== undefined) playerUpdates.battingStyle = battingStyle;
    if (bowlingStyle !== undefined) playerUpdates.bowlingStyle = bowlingStyle;
    if (dob !== undefined) playerUpdates.dob = dob;
    if (gender !== undefined) playerUpdates.gender = gender;

    if (Object.keys(playerUpdates).length > 0) {
      await storage.updatePlayerProfile(userId, playerUpdates);
    }

    const updatedPlayer = await storage.getPlayerByUserId(userId);
    res.json(updatedPlayer);
  });

  app.post("/api/players/:userId/views", async (req, res) => {
    const player = await storage.incrementPlayerViews(req.params.userId);
    res.json(player);
  });

  app.post("/api/users/:targetUserId/follow", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.followUser(userId, req.params.targetUserId);
    res.json(user);
  });

  app.post("/api/users/:targetUserId/unfollow", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.unfollowUser(userId, req.params.targetUserId);
    res.json(user);
  });

  // Match & Scoring Routes
  app.post("/api/matches", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = await storage.getUser(userId);

    if (!user || !['admin', 'captain', 'developer'].includes(user.role)) {
      return res.status(403).json({ message: "Only Team Captains or Admins can create matches" });
    }

    const { teamA, teamB } = req.body;
    if (!teamA || !teamB) {
      return res.status(400).json({ message: "Both teams must be selected" });
    }

    if (user.role === 'captain') {
      const team = await storage.getTeam(teamA);
      console.log('DEBUG: team:', team);
      console.log('DEBUG: user:', user);
      const userIdStr = (user.id || user._id || "").toString();
      if (!team || (team.adminId && team.adminId.toString() !== userIdStr)) {
        return res.status(403).json({ message: "You can only create matches for your own team" });
      }
    }

    const matchData = {
      ...req.body,
      createdById: user.id,
      scorerId: user.id,
      status: 'upcoming'
    };

    const match = await storage.createMatch(matchData);
    res.status(201).json(match);
  });

  app.get("/api/matches", async (req, res) => {
    const matches = await storage.getMatches();
    res.json(matches);
  });

  app.get("/api/matches/:id", async (req, res) => {
    const match = await storage.getMatch(req.params.id);
    if (!match) return res.status(404).json({ message: "Match not found" });
    res.json(match);
  });

  app.patch("/api/matches/:id", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = await storage.getUser(userId);

    if (!user || !['admin', 'captain', 'developer'].includes(user.role)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const { venue, startDate, date } = req.body;
    const existingMatch = await storage.getMatch(req.params.id);
    if (!existingMatch) return res.status(404).json({ message: "Match not found" });

    const updates: any = {};
    if (venue !== undefined) updates.venue = venue;
    if (startDate !== undefined) updates.date = new Date(startDate || date);
    if (date !== undefined && startDate === undefined) updates.date = new Date(date);

    const match = await storage.updateMatch(req.params.id, updates);

    // Notify teams about rescheduling
    if (updates.date || updates.venue) {
      const teamAAdmin = match.teamA?.adminId?._id || match.teamA?.adminId;
      const teamBAdmin = match.teamB?.adminId?._id || match.teamB?.adminId;
      
      const admins = [teamAAdmin, teamBAdmin].filter(id => !!id);
      for (const adminId of admins) {
        await storage.createNotification({
          userId: adminId.toString(),
          title: "Match Rescheduled",
          message: `Match #${match.matchNumber || ""} (${match.teamA?.name} vs ${match.teamB?.name}) has been rescheduled to ${new Date(match.date).toLocaleString()} at ${match.venue}.`,
          type: 'match'
        });
      }
    }

    broadcastMatchUpdate(req.params.id, match);
    res.json(match);
  });

  app.patch("/api/matches/:id/toss", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const { winner, decision } = req.body;
    const match = await storage.getMatch(req.params.id);
    if (!match) return res.status(404).json({ message: "Match not found" });

    const user = await storage.getUser(userId);
    const isDeveloper = user && user.role === 'developer';
    const isAdmin = user && user.role === 'admin';

    const updates: any = { toss: { winner, decision } };
    
    // Set initial batting and bowling teams
    if (decision === 'bat') {
      updates.battingTeam = winner;
      updates.bowlingTeam = winner.toString() === match.teamA._id.toString() ? match.teamB._id : match.teamA._id;
    } else {
      updates.bowlingTeam = winner;
      updates.battingTeam = winner.toString() === match.teamA._id.toString() ? match.teamB._id : match.teamA._id;
    }

    const updatedMatch = await storage.updateMatch(req.params.id, updates);
    broadcastMatchUpdate(req.params.id, updatedMatch);
    res.json(updatedMatch);
  });

  app.post("/api/matches/:id/walkover", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const { winningTeamId, reason } = req.body;
    
    if (!winningTeamId || !reason) {
      return res.status(400).json({ message: "Winning team and reason are required" });
    }

    const user = await storage.getUser(userId);
    if (!user || !['admin', 'developer', 'captain'].includes(user.role)) {
      return res.status(403).json({ message: "Only Admins, Tournament Managers or Team Captains can declare a walkover" });
    }

    try {
      const updatedMatch = await storage.declareWalkover(req.params.id, winningTeamId, reason);
      broadcastMatchUpdate(req.params.id, updatedMatch);
      
      if (updatedMatch.tournamentId) {
        const tournament = await storage.getTournament(updatedMatch.tournamentId.toString());
        broadcastTournamentUpdate(updatedMatch.tournamentId.toString(), tournament);
      }
      
      res.json(updatedMatch);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/matches/:id/playing-xi", async (req, res) => {
    const { teamA, teamB } = req.body;
    console.log(`[DEBUG] Updating playing XI for match ${req.params.id}`, { teamA, teamB });
    const updatedMatch = await storage.updateMatch(req.params.id, { playingXIA: teamA, playingXIB: teamB });
    broadcastMatchUpdate(req.params.id, updatedMatch);
    res.json(updatedMatch);
  });

  app.patch("/api/matches/:id/status", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const { status, striker, nonStriker, currentBowler, awards } = req.body;
    
    const user = await storage.getUser(userId);
    const match = await storage.getMatch(req.params.id);
    if (!match) return res.status(404).json({ message: "Match not found" });

    const isDeveloper = user && user.role === 'developer';
    const isAdmin = user && user.role === 'admin';

    const updates: any = {};
    if (status) updates.status = status;
    if (striker) updates.striker = striker;
    if (nonStriker) updates.nonStriker = nonStriker;
    
    if (currentBowler) {
      const currentInnings = match.innings || 1;
      const inningsBalls = match.balls.filter((b: any) => b.innings === currentInnings);
      const currentInningsLegalBalls = inningsBalls.filter((b: any) => !['wide', 'noball'].includes(b.extra)).length;
      
      const isOverComplete = currentInningsLegalBalls > 0 && currentInningsLegalBalls % 6 === 0 && !['wide', 'noball'].includes(inningsBalls[inningsBalls.length - 1].extra);
      const isOverStarted = inningsBalls.length > 0 && !isOverComplete;

      if (isOverStarted && !isDeveloper) {
        const existingBowlerId = match.currentBowler?._id?.toString() || match.currentBowler?.toString();
        if (existingBowlerId && existingBowlerId !== currentBowler.toString()) {
          return res.status(400).json({ message: "Cannot change bowler mid-over. The bowler must complete the entire over (6 legal balls)." });
        }
      }
      updates.currentBowler = currentBowler;
    }
    
    if (awards) updates.awards = awards;

    const updatedMatch = await storage.updateMatch(req.params.id, updates);
    broadcastMatchUpdate(req.params.id, updatedMatch);
    res.json(updatedMatch);
  });

  app.patch("/api/matches/:id/scorer", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const { scorerId } = req.body;
    
    const user = await storage.getUser(userId);
    const match = await storage.getMatch(req.params.id);
    if (!match) return res.status(404).json({ message: "Match not found" });

    const isDeveloper = user && user.role === 'developer';
    const isAdmin = user && user.role === 'admin';
    const isCreator = match.createdById && (
      (match.createdById._id && match.createdById._id.toString() === userId) || 
      (match.createdById.toString() === userId)
    );
    const isTeamCaptain = (
      (match.teamA?.adminId?._id && match.teamA.adminId._id.toString() === userId) ||
      (match.teamA?.adminId && match.teamA.adminId.toString() === userId) ||
      (match.teamB?.adminId?._id && match.teamB.adminId._id.toString() === userId) ||
      (match.teamB?.adminId && match.teamB.adminId.toString() === userId)
    );

    if (!isDeveloper && !isAdmin && !isCreator && !isTeamCaptain) {
      return res.status(403).json({ message: "Only Admins or Team Captains of participating teams can assign scorers" });
    }

    const updatedMatch = await storage.updateMatch(req.params.id, { scorerId });
    
    // Notify the assigned scorer
    if (scorerId) {
      const matchDetails = await storage.getMatch(req.params.id);
      if (matchDetails) {
        await storage.createNotification({
          userId: scorerId,
          title: "Scorer Assigned",
          message: `You have been assigned as the scorer for ${matchDetails.teamA?.name} vs ${matchDetails.teamB?.name}`,
          type: 'match'
        });
      }
    }
    
    broadcastMatchUpdate(req.params.id, updatedMatch);
    res.json(updatedMatch);
  });

  app.post("/api/score/ball", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const { matchId, ball } = req.body;
    
    const user = await storage.getUser(userId);
    const match = await storage.getMatch(matchId);
    
    if (!match) return res.status(404).json({ message: "Match not found" });

    const isDeveloper = user && user.role === 'developer';
    const isAdmin = user && user.role === 'admin';

    // Scorer or Developer or Admin can update
    const isScorer = match.scorerId && (
      (match.scorerId._id && match.scorerId._id.toString() === userId) || 
      (match.scorerId.toString() === userId)
    );
    
    if (!isScorer && !isDeveloper && !isAdmin) {
      return res.status(403).json({ message: "Only the authorized scorer or admin can update match events" });
    }

    // 1. Bowler Change Rule: Same bowler cannot bowl two consecutive overs
    const inningsBalls = match.balls.filter((b: any) => b.innings === match.innings);
    if (inningsBalls.length > 0) {
      const lastBall = inningsBalls[inningsBalls.length - 1];
      const lastOver = lastBall.over;
      const currentInningsLegalBalls = inningsBalls.filter((b: any) => !['wide', 'noball'].includes(b.extra)).length;
      const currentOver = Math.floor(currentInningsLegalBalls / 6);
      
      if (currentOver > lastOver && lastBall.bowler?._id?.toString() === ball.bowler.toString()) {
        return res.status(400).json({ message: "The same bowler cannot bowl two consecutive overs" });
      }
    }

    // Generate Commentary
    const batsman = await storage.getUser(ball.batsman);
    const bowler = await storage.getUser(ball.bowler);
    const commentaryText = generateCommentary({
      batsmanName: batsman?.fullName || "Unknown Batsman",
      bowlerName: bowler?.fullName || "Unknown Bowler",
      runs: ball.runs || 0,
      shotDirection: ball.shotDirection,
      boundaryType: ball.boundaryType,
      extra: ball.extra,
      wicket: ball.wicket,
      wicketType: ball.wicketType
    });

    const ballWithCommentary = {
      ...ball,
      innings: match.innings,
      commentary: commentaryText
    };

    const updatedMatch = await storage.recordBall(matchId, ballWithCommentary);

    // 2. Logic for legal balls and over completion
    const legalBalls = updatedMatch.balls.filter((b: any) => b.innings === match.innings && !['wide', 'noball'].includes(b.extra));
    const totalLegalBalls = legalBalls.length;
    const isOverComplete = totalLegalBalls > 0 && totalLegalBalls % 6 === 0 && !['wide', 'noball'].includes(ball.extra);
    
    // 3. Striker Change Rules
    let nextStriker = updatedMatch.striker;
    let nextNonStriker = updatedMatch.nonStriker;
    let nextBowler = updatedMatch.currentBowler;

    // Handle runs and striker rotation
    const runs = ball.runs || 0;
    if (runs === 1 || runs === 3) {
      // Swap striker and non-striker for odd runs
      const temp = nextStriker;
      nextStriker = nextNonStriker;
      nextNonStriker = temp;
    }

    // Handle Over End: Batsmen swap ends and bowler is reset
    if (isOverComplete) {
      const temp = nextStriker;
      nextStriker = nextNonStriker;
      nextNonStriker = temp;
      nextBowler = null; // Reset bowler to prompt for a new one
    }

    // Handle Wicket: Reset the batsman who got out
    if (ball.wicket) {
      const wicketBatsmanId = (ball.wicketBatsman?._id || ball.wicketBatsman || "").toString();
      const currentStrikerId = (nextStriker?._id || nextStriker || "").toString();
      const currentNonStrikerId = (nextNonStriker?._id || nextNonStriker || "").toString();

      if (wicketBatsmanId === currentStrikerId) {
        nextStriker = null;
      } else if (wicketBatsmanId === currentNonStrikerId) {
        nextNonStriker = null;
      } else {
        // Fallback for non-runout wickets or if ID wasn't set correctly
        nextStriker = null;
      }
    }

    // Update match state with new striker/bowler positions
    await storage.updateMatch(matchId, {
      striker: nextStriker?._id || nextStriker,
      nonStriker: nextNonStriker?._id || nextNonStriker,
      currentBowler: nextBowler?._id || nextBowler
    });

    const currentInningsBallsData = updatedMatch.balls.filter((b: any) => b.innings === match.innings);
    const totalRuns = currentInningsBallsData.reduce((acc: number, b: any) => acc + (b.runs || 0) + (['wide', 'noball'].includes(b.extra) ? 1 : 0), 0);
    const totalWickets = currentInningsBallsData.filter((b: any) => b.wicket && b.wicketType !== 'retired hurt').length;
    const maxOvers = updatedMatch.overs;
    const battingTeamPlayers = updatedMatch.battingTeam._id.toString() === updatedMatch.teamA._id.toString() ? updatedMatch.playingXIA : updatedMatch.playingXIB;
    const maxWickets = (battingTeamPlayers?.length || 11) - 1;

    let matchStatus = updatedMatch.status;
    let matchInnings = updatedMatch.innings;
    let matchWinner = updatedMatch.winner;
    let matchResult = updatedMatch.result;
    let matchTarget = updatedMatch.target;

    const isOversCompleted = totalLegalBalls >= maxOvers * 6;
    const isWicketsCompleted = totalWickets >= maxWickets;

    if (matchInnings === 1) {
      if (isOversCompleted || isWicketsCompleted) {
        // End of first innings
        matchInnings = 2;
        const totalRunsInnings1 = updatedMatch.balls.filter((b: any) => b.innings === 1).reduce((acc: number, b: any) => acc + (b.runs || 0) + (['wide', 'noball'].includes(b.extra) ? 1 : 0), 0);
        matchTarget = totalRunsInnings1 + 1;
        
        // Switch teams
        const temp = updatedMatch.battingTeam;
        const nextBattingTeam = updatedMatch.bowlingTeam;
        const nextBowlingTeam = temp;

        await storage.updateMatch(matchId, { 
          innings: matchInnings, 
          target: matchTarget,
          battingTeam: nextBattingTeam,
          bowlingTeam: nextBowlingTeam,
          striker: null,
          nonStriker: null,
          currentBowler: null
        });
      }
    } else if (matchInnings === 2) {
      // Logic for match end in 2nd innings
      const innings2Balls = updatedMatch.balls.filter((b: any) => b.innings === 2);
      const totalRunsInnings2 = innings2Balls.reduce((acc: number, b: any) => acc + (b.runs || 0) + (['wide', 'noball'].includes(b.extra) ? 1 : 0), 0);
      const totalWicketsInnings2 = innings2Balls.filter((b: any) => b.wicket && b.wicketType !== 'retired hurt').length;
      const legalBallsInnings2 = innings2Balls.filter((b: any) => !['wide', 'noball'].includes(b.extra)).length;
      
      const isOversCompleted2 = legalBallsInnings2 >= maxOvers * 6;
      const isWicketsCompleted2 = totalWicketsInnings2 >= maxWickets;

      if (totalRunsInnings2 >= matchTarget) {
        // Batting team won (chasing team)
        matchStatus = 'completed';
        matchWinner = updatedMatch.battingTeam;
        const wicketsRemaining = (maxWickets + 1) - totalWicketsInnings2;
        matchResult = `${updatedMatch.battingTeam.name} won by ${wicketsRemaining} wickets`;
      } else if (isOversCompleted2 || isWicketsCompleted2) {
        // Bowling team won or Draw
        matchStatus = 'completed';
        const team1Runs = updatedMatch.balls.filter((b: any) => b.innings === 1).reduce((acc: number, b: any) => acc + (b.runs || 0) + (['wide', 'noball'].includes(b.extra) ? 1 : 0), 0);
        
        if (totalRuns < team1Runs) {
          matchWinner = updatedMatch.bowlingTeam;
          matchResult = `${updatedMatch.bowlingTeam.name} won by ${team1Runs - totalRuns} runs`;
        } else if (totalRuns === team1Runs) {
          matchResult = "Match Tied";
        }
      } else {
        // Match still in progress
        matchStatus = 'live';
        matchResult = "Match In Progress";
      }

      if (matchStatus === 'completed') {
        const awards = calculateAwards(updatedMatch);
        await storage.updateMatch(matchId, { 
          status: matchStatus,
          winner: matchWinner,
          result: matchResult,
          awards
        });

        // Send notifications to all participating players
        const allPlayers = [...(updatedMatch.playingXIA || []), ...(updatedMatch.playingXIB || [])];
        for (const player of allPlayers) {
          const playerId = player._id?.toString() || player.toString();
          await storage.createNotification({
            userId: playerId,
            title: "Match Completed",
            message: `${updatedMatch.teamA.name} vs ${updatedMatch.teamB.name}: ${matchResult}`,
            type: 'match'
          });
        }
      } else {
        // Explicitly update result to "Match In Progress" if it's still live
        await storage.updateMatch(matchId, { 
          result: matchResult
        });
      }

        // Update Tournament Standings if applicable
        if (updatedMatch.tournamentId) {
          const tournamentIdString = updatedMatch.tournamentId._id ? updatedMatch.tournamentId._id.toString() : updatedMatch.tournamentId.toString();
          await storage.updateTournamentStandings(tournamentIdString);
          
          const tournament = await storage.getTournament(tournamentIdString);
          if (tournament && (tournament.tournamentType === 'League + Knockout')) {
            const standings = tournament.standings;
            // Handle Qualification logic for League + Knockout
            const remainingLeagueMatches = await storage.countMatches(tournamentIdString, 'league', 'completed');

            if (remainingLeagueMatches === 0) {
              const hasPlayoffs = await storage.hasMatchStage(tournamentIdString, ['semifinal', 'final']);

              if (!hasPlayoffs) {
                // All league matches completed, generate semifinals
                const top4 = [...standings].sort((a, b) => b.pts - a.pts || b.nrr - a.nrr).slice(0, 4);
                if (top4.length >= 2) {
                  const matchOvers = tournament.oversPerMatch || (tournament.format === 'T20' ? 20 : 10);
                  
                  if (top4.length === 4) {
                    const semi1 = await storage.createMatch({
                      teamA: top4[0].teamId,
                      teamB: top4[3].teamId,
                      status: 'upcoming',
                      overs: matchOvers,
                      venue: tournament.location || 'Tournament Ground',
                      tournamentId: tournament._id,
                      stage: 'semifinal',
                      startDate: new Date(new Date().setDate(new Date().getDate() + 1))
                    });
                    const semi2 = await storage.createMatch({
                      teamA: top4[1].teamId,
                      teamB: top4[2].teamId,
                      status: 'upcoming',
                      overs: matchOvers,
                      venue: tournament.location || 'Tournament Ground',
                      tournamentId: tournament._id,
                      stage: 'semifinal',
                      startDate: new Date(new Date().setDate(new Date().getDate() + 1))
                    });
                    tournament.matches.push(semi1._id, semi2._id);
                  } else if (top4.length >= 2) {
                    // Just final if only 2 or 3 teams
                    const final = await storage.createMatch({
                      teamA: top4[0].teamId,
                      teamB: top4[1].teamId,
                      status: 'upcoming',
                      overs: matchOvers,
                      venue: tournament.location || 'Tournament Ground',
                      tournamentId: tournament._id,
                      stage: 'final',
                      startDate: new Date(new Date().setDate(new Date().getDate() + 1))
                    });
                    tournament.matches.push(final._id);
                  }
                  await storage.updateTournament(tournament._id, { matches: tournament.matches });
                }
              }
            }
            
            // Progression for Semifinals to Final
            if (updatedMatch.stage === 'semifinal') {
              const remainingSemis = await storage.countMatches(tournamentIdString, 'semifinal', 'completed');

              if (remainingSemis === 0) {
                const semiFinals = await storage.getMatchesByTournament(tournamentIdString, 'semifinal');
                
                if (semiFinals.length === 2 && semiFinals[0].winner && semiFinals[1].winner) {
                  const matchOvers = tournament.oversPerMatch || (tournament.format === 'T20' ? 20 : 10);
                  const final = await storage.createMatch({
                    teamA: semiFinals[0].winner,
                    teamB: semiFinals[1].winner,
                    status: 'upcoming',
                    overs: matchOvers,
                    venue: tournament.location || 'Tournament Ground',
                    tournamentId: tournament._id,
                    stage: 'final',
                    startDate: new Date(new Date().setDate(new Date().getDate() + 2))
                  });
                  tournament.matches.push(final._id);
                  await storage.updateTournament(tournament._id, { matches: tournament.matches });
                }
              }
            }

            // Tournament completion
            if (updatedMatch.stage === 'final') {
               await storage.updateTournament(tournament._id, { 
                 status: 'completed', 
                 winner: updatedMatch.winner 
               });

               // Send notifications to all members of all teams in the tournament
               for (const team of tournament.teams) {
                 const teamData = await storage.getTeam(team._id || team);
                 if (teamData && teamData.players) {
                   for (const player of teamData.players) {
                     await storage.createNotification({
                       userId: player._id || player,
                       title: "Tournament Completed",
                       message: `${tournament.name} has concluded. Congratulations to the winners!`,
                       type: 'tournament'
                     });
                   }
                 }
               }
            }
          }
        }
      }

    const finalMatchUpdated = await storage.getMatch(matchId);
    broadcastMatchUpdate(matchId, finalMatchUpdated);
    res.json(finalMatchUpdated);
  });

  app.post("/api/matches/:id/end-innings", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const matchId = req.params.id;
    
    const user = await storage.getUser(userId);
    const match = await storage.getMatch(matchId);
    
    if (!match) return res.status(404).json({ message: "Match not found" });

    const isScorer = match.scorerId && (
      (match.scorerId._id && match.scorerId._id.toString() === userId) || 
      (match.scorerId.toString() === userId)
    );
    const isDeveloper = user && user.role === 'developer';
    const isCreatedBy = match.createdById && (
      (match.createdById._id && match.createdById._id.toString() === userId) ||
      (match.createdById.toString() === userId)
    );
    
    if (!isScorer && !isDeveloper && !isCreatedBy && user?.role !== 'admin') {
      return res.status(403).json({ message: "Only authorized personnel can end innings" });
    }

    const updatedMatch = await storage.endInnings(matchId);
    broadcastMatchUpdate(matchId, updatedMatch);
    res.json(updatedMatch);
  });

  app.post("/api/matches/:id/end-match", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const matchId = req.params.id;
    
    const user = await storage.getUser(userId);
    const match = await storage.getMatch(matchId);
    
    if (!match) return res.status(404).json({ message: "Match not found" });

    const isScorer = match.scorerId && (
      (match.scorerId._id && match.scorerId._id.toString() === userId) || 
      (match.scorerId.toString() === userId)
    );
    const isDeveloper = user && user.role === 'developer';
    const isCreatedBy = match.createdById && (
      (match.createdById._id && match.createdById._id.toString() === userId) ||
      (match.createdById.toString() === userId)
    );
    
    if (!isScorer && !isDeveloper && !isCreatedBy && user?.role !== 'admin') {
      return res.status(403).json({ message: "Only authorized personnel can end the match" });
    }

    const updatedMatch = await storage.endMatch(matchId);
    broadcastMatchUpdate(matchId, updatedMatch);
    res.json(updatedMatch);
  });

  app.post("/api/score/undo", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const { matchId } = req.body;
    
    const user = await storage.getUser(userId);
    const match = await storage.getMatch(matchId);
    
    if (!match) return res.status(404).json({ message: "Match not found" });

    const isScorer = match.scorerId && (
      (match.scorerId._id && match.scorerId._id.toString() === userId) || 
      (match.scorerId.toString() === userId)
    );
    const isDeveloper = user && user.role === 'developer';
    
    if (!isScorer && !isDeveloper) {
      return res.status(403).json({ message: "Only the authorized scorer can update match events" });
    }

    if (match.balls.length === 0) {
      return res.status(400).json({ message: "No balls to undo" });
    }

    // Get the ball being removed to revert striker/non-striker if needed
    const lastBall = match.balls[match.balls.length - 1];
    
    const updatedMatch = await storage.undoBall(matchId);

    // Re-calculate striker/non-striker positions based on remaining balls
    // This is complex, but for now we'll just undo the last change
    // A better way is to select them again in the frontend
    
    broadcastMatchUpdate(matchId, updatedMatch);
    res.json(updatedMatch);
  });

  // Finance Routes
  app.post("/api/collections", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = await storage.getUser(userId);
    if (!user || !['admin', 'captain', 'developer'].includes(user.role)) {
      return res.status(403).json({ message: "Only Admins and Captains can create collections" });
    }
    const collection = await storage.createCollection(req.body);
    res.status(201).json(collection);
  });

  app.get("/api/collections/team/:teamId", async (req, res) => {
    const collections = await storage.getCollectionsByTeam(req.params.teamId);
    res.json(collections);
  });

  app.post("/api/payments", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = await storage.getUser(userId);
    if (!user || !['admin', 'captain', 'developer'].includes(user.role)) {
      // Allow user to create their own payment (maybe for proof upload?)
      if (req.body.memberId !== userId) {
        return res.status(403).json({ message: "Unauthorized payment creation" });
      }
    }
    const payment = await storage.createPayment(req.body);
    res.status(201).json(payment);
  });

  app.get("/api/payments/collection/:collectionId", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = await storage.getUser(userId);
    if (!user || !['admin', 'captain', 'developer'].includes(user.role)) {
      return res.status(403).json({ message: "Only Admins and Captains can view all payments in a collection" });
    }
    const payments = await storage.getPaymentsByCollection(req.params.collectionId);
    res.json(payments);
  });

  app.get("/api/payments/member/:memberId", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = await storage.getUser(userId);
    if (!user || (!['admin', 'captain', 'developer'].includes(user.role) && req.params.memberId !== userId)) {
      return res.status(403).json({ message: "You can only view your own payments" });
    }
    const payments = await storage.getPaymentsByMember(req.params.memberId);
    res.json(payments);
  });

  app.patch("/api/payments/:id", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = await storage.getUser(userId);
    const { status } = req.body;
    
    // For now, allow player to mark their own as paid for demo/testing
    // Normally this would require admin approval or gateway confirmation
    const payment = await (storage as any).getPayment(req.params.id);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (!user || (!['admin', 'captain', 'developer'].includes(user.role) && payment.memberId.toString() !== userId)) {
      return res.status(403).json({ message: "Unauthorized payment update" });
    }

    const updated = await storage.updatePaymentStatus(req.params.id, status);
    res.json(updated);
  });

  app.post("/api/payments/submit", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const { paymentId, transactionId, proofImage, amount } = req.body;
    
    if (!paymentId || !transactionId || !amount) {
      return res.status(400).json({ message: "Missing required payment details" });
    }

    const payment = await storage.getPayment(paymentId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (payment.memberId.toString() !== userId) {
      return res.status(403).json({ message: "You can only submit payments for yourself" });
    }

    const updated = await storage.submitPayment(paymentId, { transactionId, proofImage, amount });
    res.json(updated);
  });

  app.get("/api/payments/pending-verifications", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = await storage.getUser(userId);
    
    if (!user || !['admin', 'developer'].includes(user.role)) {
      return res.status(403).json({ message: "Only Admins can view pending verifications" });
    }

    const pending = await storage.getPendingVerifications();
    res.json(pending);
  });

  app.patch("/api/payments/:id/verify", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = await storage.getUser(userId);
    const { status } = req.body; // 'Paid' or 'rejected'
    
    if (!user || !['admin', 'developer'].includes(user.role)) {
      return res.status(403).json({ message: "Only Admins can verify payments" });
    }

    if (!['Paid', 'rejected'].includes(status)) {
      return res.status(400).json({ message: "Invalid status for verification" });
    }

    const updated = await storage.verifyPayment(req.params.id, status, userId);
    if (!updated) return res.status(404).json({ message: "Payment not found" });

    // Send notification to the player
    await storage.createNotification({
      userId: updated.memberId._id,
      title: `Payment ${status === 'Paid' ? 'Verified' : 'Rejected'}`,
      message: `Your payment for "${updated.collectionId.title}" has been ${status === 'Paid' ? 'verified successfully.' : 'rejected. Please contact admin.'}`,
      type: 'payment'
    });

    res.json(updated);
  });

  app.post("/api/expenses", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = await storage.getUser(userId);
    if (!user || !['admin', 'captain', 'developer'].includes(user.role)) {
      return res.status(403).json({ message: "Only Admins and Captains can record expenses" });
    }
    const expense = await storage.createExpense(req.body);
    res.status(201).json(expense);
  });

  app.get("/api/expenses", async (req, res) => {
    const expenses = await storage.getExpenses();
    res.json(expenses);
  });

  app.get("/api/expenses/collection/:collectionId", async (req, res) => {
    const expenses = await storage.getExpensesByCollection(req.params.collectionId);
    res.json(expenses);
  });

  // Tournament Routes
  app.post("/api/tournaments", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const tournamentData = {
      ...req.body,
      adminId: userId,
      currentStep: 'SETTINGS',
      status: 'upcoming'
    };

    const tournament = await storage.createTournament(tournamentData);
    res.status(201).json(tournament);
  });

  app.patch("/api/tournaments/:id", async (req, res) => {
    const tournament = await storage.updateTournament(req.params.id, req.body);
    if (!tournament) return res.status(404).json({ message: "Tournament not found" });
    res.json(tournament);
  });

  app.post("/api/tournaments/:id/teams", async (req, res) => {
    const { teamId } = req.body;
    const tournament = await storage.addTeamToTournament(req.params.id, teamId);
    res.json(tournament);
  });

  app.delete("/api/tournaments/:id/teams/:teamId", async (req, res) => {
    const tournament = await storage.removeTeamFromTournament(req.params.id, req.params.teamId);
    res.json(tournament);
  });

  app.post("/api/tournaments/:id/groups", async (req, res) => {
    const { groups } = req.body;
    const tournament = await storage.setTournamentGroups(req.params.id, groups);
    res.json(tournament);
  });

  app.post("/api/tournaments/:id/rounds", async (req, res) => {
    const { rounds } = req.body;
    const tournament = await storage.setTournamentRounds(req.params.id, rounds);
    res.json(tournament);
  });

  app.post("/api/tournaments/:id/generate-matches", async (req, res) => {
    try {
      // Save the configuration first
      if (req.body) {
        await storage.updateTournament(req.params.id, { fixtureConfig: req.body });
      }
      const tournament = await storage.generateTournamentMatches(req.params.id);
      res.json(tournament);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/tournaments", async (req, res) => {
    const tournaments = await storage.getTournaments();
    res.json(tournaments);
  });

  app.get("/api/tournaments/:id", async (req, res) => {
    const tournament = await storage.getTournament(req.params.id);
    if (!tournament) return res.status(404).json({ message: "Tournament not found" });
    res.json(tournament);
  });

  app.get("/api/tournaments/:id/bracket", async (req, res) => {
    const bracket = await storage.getTournamentBracket(req.params.id);
    res.json(bracket);
  });

  app.get("/api/tournaments/:id/stats", async (req, res) => {
    const stats = await storage.getTournamentStats(req.params.id);
    res.json(stats);
  });

  app.post("/api/tournaments/:id/standings", async (req, res) => {
    const tournament = await storage.updateStandings(req.params.id, req.body.standings);
    res.json(tournament);
  });

  app.post("/api/tournaments/:id/generate-playoffs", async (req, res) => {
    try {
      const tournament = await storage.generatePlayoffs(req.params.id);
      res.json(tournament);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Analytics Routes
  app.get("/api/stats", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = await storage.getUser(userId);
    const stats = await storage.getStats(userId, user?.role);
    res.json(stats);
  });

  app.get("/api/stats/player/:id", async (req, res) => {
    const player = await storage.getPlayerByUserId(req.params.id);
    if (!player) return res.status(404).json({ message: "Player not found" });
    res.json(player);
  });

  app.get("/api/player-stats/:id", async (req, res) => {
    const { year, opponent } = req.query;
    const stats = await storage.getPlayerDetailedStats(
      req.params.id, 
      year ? parseInt(year as string) : undefined,
      opponent as string
    );
    if (!stats) return res.status(404).json({ message: "Player not found" });
    res.json(stats);
  });

  app.get("/api/stats/years", async (_req, res) => {
    const years = await storage.getMatchYears();
    res.json(years);
  });

  app.get("/api/stats/team/:id", async (req, res) => {
    const team = await storage.getTeam(req.params.id);
    if (!team) return res.status(404).json({ message: "Team not found" });
    res.json(team);
  });

  app.get("/api/stats/leaderboard", async (req, res) => {
    const { type } = req.query;
    const leaderboard = await storage.getLeaderboard(type as string || 'runs');
    res.json(leaderboard);
  });

  app.get("/api/stats/match/:id", async (req, res) => {
    const match = await storage.getMatch(req.params.id);
    if (!match) return res.status(404).json({ message: "Match not found" });
    
    // Generate analytics if needed
    res.json(match);
  });

  app.get("/api/leaderboard", async (req, res) => {
    const { season, opponent, tournamentId } = req.query;
    const leaderboard = await storage.getLeaderboard(season as string, opponent as string, tournamentId as string);
    res.json(leaderboard);
  });

  app.get("/api/match-years", async (req, res) => {
    const years = await storage.getMatchYears();
    res.json(years);
  });

  // Developer Routes
  app.post("/api/dev/wipe", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    const user = await storage.getUser(userId);
    
    if (!user || user.role !== 'developer') {
      return res.status(403).json({ message: "Only developers can wipe the database" });
    }
    
    await storage.wipeDatabase();
    res.json({ message: "Database wiped successfully" });
  });

  // Upload Route (Mock)
  app.post("/api/upload", async (req, res) => {
    const { image, userId, type } = req.body; // base64 image
    if (!image) return res.status(400).json({ message: "No image provided" });
    
    // In a real app, save to S3 or local storage
    // For now, we return a mock URL
    const mockUrl = `https://placehold.co/200x200?text=${type}`;
    res.json({ url: mockUrl });
  });

  // Notification Routes
  app.get("/api/notifications", async (req, res) => {
    const userId = req.headers["x-user-id"] as string;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const notifications = await storage.getNotifications(userId);
    res.json(notifications);
  });

  app.patch("/api/notifications/:id/read", async (req, res) => {
    const updated = await storage.markNotificationRead(req.params.id);
    res.json(updated);
  });

  return httpServer;
}

function calculateAwards(match: any) {
  const batsmen: Record<string, any> = {};
  const bowlers: Record<string, any> = {};
  const fielders: Record<string, any> = {};

  match.balls.forEach((b: any) => {
    const batId = (b.batsman?._id || b.batsman || "unknown").toString();
    const bowlId = (b.bowler?._id || b.bowler || "unknown").toString();
    const batName = b.batsman?.fullName || b.batsman?.name || "Unknown";
    const bowlName = b.bowler?.fullName || b.bowler?.name || "Unknown";
    
    if (batId !== "unknown") {
      if (!batsmen[batId]) batsmen[batId] = { id: batId, name: batName, runs: 0, balls: 0, fours: 0, sixes: 0, dotBalls: 0 };
      const runs = b.runs || 0;
      if (b.extra !== 'wide') {
        batsmen[batId].balls++;
        batsmen[batId].runs += runs;
        if (runs === 4) batsmen[batId].fours++;
        if (runs === 6) batsmen[batId].sixes++;
        if (runs === 0 && !b.extra) batsmen[batId].dotBalls++;
      }
    }

    if (bowlId !== "unknown") {
      if (!bowlers[bowlId]) bowlers[bowlId] = { id: bowlId, name: bowlName, runs: 0, balls: 0, wickets: 0, dotBalls: 0 };
      if (b.extra === 'wide' || b.extra === 'noball') {
        bowlers[bowlId].runs += (b.runs || 0) + 1;
      } else {
        bowlers[bowlId].balls++;
        bowlers[bowlId].runs += (b.runs || 0);
        if (b.runs === 0 && !b.extra) bowlers[bowlId].dotBalls++;
      }
      if (b.wicket) {
        // Only count as bowler wicket if not run-out
        if (b.wicket !== 'run-out') {
          bowlers[bowlId].wickets++;
        }
      }
    }

    // Fielding Logic (if wicket type and fielder is provided)
    if (b.wicket && b.fielder) {
      const fielderId = (b.fielder?._id || b.fielder).toString();
      const fielderName = b.fielder?.fullName || b.fielder?.name || "Unknown";
      if (!fielders[fielderId]) fielders[fielderId] = { id: fielderId, name: fielderName, catches: 0, runOuts: 0, stumpings: 0 };
      
      if (b.wicket === 'caught') fielders[fielderId].catches++;
      if (b.wicket === 'run-out') fielders[fielderId].runOuts++;
      if (b.wicket === 'stumped') fielders[fielderId].stumpings++;
    }
  });

  const bestBat = Object.values(batsmen).sort((a, b) => {
    if (b.runs !== a.runs) return b.runs - a.runs;
    const srA = a.balls > 0 ? (a.runs / a.balls) : 0;
    const srB = b.balls > 0 ? (b.runs / b.balls) : 0;
    if (srB !== srA) return srB - srA;
    if ((b.fours + b.sixes) !== (a.fours + a.sixes)) return (b.fours + b.sixes) - (a.fours + a.sixes);
    return a.balls - b.balls;
  })[0];

  const bestBowl = Object.values(bowlers).sort((a, b) => {
    if (b.wickets !== a.wickets) return b.wickets - a.wickets;
    if (a.runs !== b.runs) return a.runs - b.runs;
    const econA = a.balls > 0 ? (a.runs / (a.balls / 6)) : 0;
    const econB = b.balls > 0 ? (b.runs / (b.balls / 6)) : 0;
    if (econA !== econB) return econA - econB;
    return b.dotBalls - a.dotBalls;
  })[0];

  const playerScores: Record<string, number> = {};
  
  // Batting Score = Runs + (StrikeRate × 0.1)
  Object.values(batsmen).forEach((b: any) => {
    const sr = b.balls > 0 ? (b.runs / b.balls) * 100 : 0;
    const score = b.runs + (sr * 0.1);
    playerScores[b.id] = (playerScores[b.id] || 0) + score;
  });

  // Bowling Score = (Wickets × 20) − RunsConceded × 0.2
  Object.values(bowlers).forEach((b: any) => {
    const score = (b.wickets * 20) - (b.runs * 0.2);
    playerScores[b.id] = (playerScores[b.id] || 0) + score;
  });

  // Fielding Score = (Catches × 5) + (RunOuts × 10) + (Stumpings × 5)
  Object.values(fielders).forEach((f: any) => {
    const score = (f.catches * 5) + (f.runOuts * 10) + (f.stumpings * 5);
    playerScores[f.id] = (playerScores[f.id] || 0) + score;
  });

  const motmEntry = Object.entries(playerScores).sort((a, b) => b[1] - a[1])[0];

  return {
    manOfTheMatch: motmEntry ? motmEntry[0] : null,
    bestBatsman: bestBat ? bestBat.id : null,
    bestBowler: bestBowl ? bestBowl.id : null
  };
}
