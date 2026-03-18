import { pgTable, text, serial, integer, boolean, timestamp, jsonb, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User Table (members)
export const users = pgTable("members", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  username: text("username"),
  mobileNumber: text("mobile_number").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  role: text("role", { enum: ["admin", "captain", "player", "public", "developer"] }).default("player").notNull(),
  profileImage: text("profile_image"),
  isApproved: boolean("is_approved").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  teams: jsonb("teams").$type<number[]>().default([]).notNull(),
  followers: jsonb("followers").$type<number[]>().default([]).notNull(),
  following: jsonb("following").$type<number[]>().default([]).notNull(),
});

// Team Table
export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  format: text("format").default("T20").notNull(),
  adminId: integer("admin_id").references(() => users.id),
  scorerId: integer("scorer_id").references(() => users.id),
  players: jsonb("players").$type<number[]>().default([]).notNull(),
  collections: jsonb("collections").$type<number[]>().default([]).notNull(),
  stats: jsonb("stats").$type<{
    totalMatches: number;
    wins: number;
    losses: number;
    winPercentage: number;
    totalRuns: number;
    totalWickets: number;
    nrr: number;
  }>().default({
    totalMatches: 0,
    wins: 0,
    losses: 0,
    winPercentage: 0,
    totalRuns: 0,
    totalWickets: 0,
    nrr: 0,
  }).notNull(),
});

// Player Table
export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  location: text("location").default("Madurai").notNull(),
  dob: timestamp("dob"),
  gender: text("gender", { enum: ["Male", "Female", "Prefer not to say"] }).default("Male").notNull(),
  views: integer("views").default(0).notNull(),
  playingRole: text("playing_role", { enum: ["Batsman", "Bowler", "All-Rounder", "Wicketkeeper", "Wicket-keeper batter"] }).default("Batsman").notNull(),
  battingStyle: text("batting_style", { enum: ["Right-hand bat", "Left-hand bat", "RHB", "LHB"] }).default("Right-hand bat").notNull(),
  bowlingStyle: text("bowling_style").default("Right-arm medium").notNull(),
  jerseyNumber: integer("jersey_number"),
  stats: jsonb("stats").$type<{
    batting: {
      runs: number;
      matches: number;
      innings: number;
      highestScore: number;
      average: number;
      strikeRate: number;
      ballsFaced: number;
      fours: number;
      sixes: number;
      fifties: number;
      hundreds: number;
    };
    bowling: {
      matches: number;
      overs: number;
      wickets: number;
      runsConceded: number;
      bestBowling: {
        wickets: number;
        runs: number;
      };
      average: number;
      economy: number;
      strikeRate: number;
      maidens: number;
    };
    runs: number;
    wickets: number;
    matches: number;
    avg: number;
    sr: number;
    er: number;
  }>().default({
    batting: { runs: 0, matches: 0, innings: 0, highestScore: 0, average: 0, strikeRate: 0, ballsFaced: 0, fours: 0, sixes: 0, fifties: 0, hundreds: 0 },
    bowling: { matches: 0, overs: 0, wickets: 0, runsConceded: 0, bestBowling: { wickets: 0, runs: 0 }, average: 0, economy: 0, strikeRate: 0, maidens: 0 },
    runs: 0, wickets: 0, matches: 0, avg: 0, sr: 0, er: 0
  }).notNull(),
});

// Match Table
export const matches = pgTable("matches", {
  id: serial("id").primaryKey(),
  teamA: integer("team_a_id").references(() => teams.id).notNull(),
  teamB: integer("team_b_id").references(() => teams.id).notNull(),
  scorerId: integer("scorer_id").references(() => users.id),
  createdById: integer("created_by_id").references(() => users.id),
  overs: integer("overs").default(20).notNull(),
  matchFormat: text("match_format", { enum: ["T10", "T20", "50 overs", "custom"] }).default("T20").notNull(),
  type: text("type"),
  venue: text("venue"),
  toss: jsonb("toss").$type<{
    winner: number | null;
    decision: "bat" | "bowl" | null;
  }>().default({ winner: null, decision: null }).notNull(),
  playingXIA: jsonb("playing_xi_a").$type<number[]>().default([]).notNull(),
  playingXIB: jsonb("playing_xi_b").$type<number[]>().default([]).notNull(),
  battingTeam: integer("batting_team_id").references(() => teams.id),
  bowlingTeam: integer("bowling_team_id").references(() => teams.id),
  striker: integer("striker_id").references(() => users.id),
  nonStriker: integer("non_striker_id").references(() => users.id),
  currentBowler: integer("current_bowler_id").references(() => users.id),
  innings: integer("innings").default(1).notNull(),
  target: integer("target"),
  winner: integer("winner_id").references(() => teams.id),
  result: text("result"),
  tournamentId: integer("tournament_id"), // Will add reference after tournament table
  stage: text("stage", { enum: ["league", "quarterfinal", "semifinal", "final", "none"] }).default("none").notNull(),
  balls: jsonb("balls").$type<any[]>().default([]).notNull(),
  awards: jsonb("awards").$type<{
    manOfTheMatch: number | null;
    manOfTheMatchDetails: any | null;
    bestPartnership: any | null;
    bestBatsman: number | null;
    bestBowler: number | null;
  }>().default({
    manOfTheMatch: null,
    manOfTheMatchDetails: null,
    bestPartnership: null,
    bestBatsman: null,
    bestBowler: null
  }).notNull(),
  status: text("status", { enum: ["scheduled", "live", "completed", "abandoned", "rescheduled", "upcoming", "delayed", "walkover"] }).default("scheduled").notNull(),
  matchNumber: integer("match_number"),
  liveLink: text("live_link"),
  date: timestamp("date").defaultNow().notNull(),
});

// Collection Table
export const collections = pgTable("collections", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").references(() => teams.id),
  tournamentId: integer("tournament_id"), // Will add reference after tournament table
  title: text("title").notNull(),
  description: text("description"),
  amountPerMember: decimal("amount_per_member", { precision: 10, scale: 2 }).notNull(),
  expectedAmt: decimal("expected_amt", { precision: 10, scale: 2 }).default("0").notNull(),
  collectedAmt: decimal("collected_amt", { precision: 10, scale: 2 }).default("0").notNull(),
  dueDate: timestamp("due_date"),
});

// Payment Table
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").references(() => users.id).notNull(),
  collectionId: integer("collection_id").references(() => collections.id).notNull(),
  status: text("status", { enum: ["Paid", "Partial", "Pending", "verification_pending", "rejected"] }).default("Pending").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).default("0").notNull(),
  proofImage: text("proof_image"),
  method: text("method"),
  transactionId: text("transaction_id"),
  submittedAt: timestamp("submitted_at"),
  verifiedBy: integer("verified_by").references(() => users.id),
  verifiedAt: timestamp("verified_at"),
});

// Tournament Table
export const tournaments = pgTable("tournaments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  city: text("city"),
  ground: text("ground"),
  organiserName: text("organiser_name"),
  organiserContact: jsonb("organiser_contact").$type<{
    countryCode: string;
    phoneNumber: string;
  }>().default({ countryCode: "+91", phoneNumber: "" }).notNull(),
  contactPermission: boolean("contact_permission").default(false).notNull(),
  tournamentCategory: text("tournament_category", { enum: ["OPEN", "CORPORATE", "COMMUNITY", "SCHOOL", "BOX CRICKET", "SERIES", "OTHER"] }).default("OPEN").notNull(),
  pitchType: text("pitch_type", { enum: ["ROUGH", "CEMENT", "TURF", "ASTROTURF", "MATTING"] }).default("TURF").notNull(),
  matchType: text("match_type", { enum: ["Limited Overs", "The Hundred", "Box Cricket", "Unlimited Overs", "Test Match", "Pair Cricket"] }).default("Limited Overs").notNull(),
  ballType: text("ball_type", { enum: ["Tennis Ball", "Leather Ball", "Other Ball"] }).default("Leather Ball").notNull(),
  tags: jsonb("tags").$type<string[]>().default([]).notNull(),
  banner: text("banner"),
  logo: text("logo"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  format: text("format").default("T20").notNull(),
  tournamentType: text("tournament_type", { enum: ["League", "Knockout", "League + Knockout"] }).default("League").notNull(),
  oversPerMatch: integer("overs_per_match").default(20).notNull(),
  adminId: integer("admin_id").references(() => users.id),
  teams: jsonb("teams").$type<number[]>().default([]).notNull(),
  matches: jsonb("matches").$type<number[]>().default([]).notNull(),
  fixtureConfig: jsonb("fixture_config").$type<{
    maxMatchesPerTeamPerDay: number;
    gapBetweenMatches: number;
    availableGrounds: string[];
  }>().default({ maxMatchesPerTeamPerDay: 1, gapBetweenMatches: 1, availableGrounds: [] }).notNull(),
  groups: jsonb("groups").$type<any[]>().default([]).notNull(),
  rounds: jsonb("rounds").$type<any[]>().default([]).notNull(),
  standings: jsonb("standings").$type<any[]>().default([]).notNull(),
  currentStep: text("current_step", { enum: ["SETTINGS", "TEAMS", "ROUNDS", "GROUPS", "MATCHES", "PUBLISHED"] }).default("SETTINGS").notNull(),
  status: text("status", { enum: ["upcoming", "live", "completed"] }).default("upcoming").notNull(),
  winner: integer("winner_id").references(() => teams.id),
});

// Expense Table
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  collectionId: integer("collection_id").references(() => collections.id),
  title: text("title").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  date: timestamp("date").defaultNow().notNull(),
});

// Notification Table
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type", { enum: ["payment", "match", "tournament", "system"] }).default("match").notNull(),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Zod schemas for inserting
export const insertUserSchema = createInsertSchema(users);
export const insertTeamSchema = createInsertSchema(teams);
export const insertPlayerSchema = createInsertSchema(players);
export const insertMatchSchema = createInsertSchema(matches);
export const insertCollectionSchema = createInsertSchema(collections);
export const insertPaymentSchema = createInsertSchema(payments);
export const insertTournamentSchema = createInsertSchema(tournaments);
export const insertExpenseSchema = createInsertSchema(expenses);
export const insertNotificationSchema = createInsertSchema(notifications);

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Match = typeof matches.$inferSelect;
export type InsertMatch = z.infer<typeof insertMatchSchema>;
export type Collection = typeof collections.$inferSelect;
export type InsertCollection = z.infer<typeof insertCollectionSchema>;
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Tournament = typeof tournaments.$inferSelect;
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
