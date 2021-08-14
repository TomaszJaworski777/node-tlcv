import { Chess } from 'chess.js';
import { parse } from 'path';
import ChessGame from './chess-game';
import { logger } from './util';

type Color = 'white' | 'black';

enum Command {
  FEN = 'FEN',
  WPLAYER = 'WPLAYER',
  BPLAYER = 'BPLAYER',
  WPV = 'WPV',
  BPV = 'BPV',
  WTIME = 'WTIME',
  BTIME = 'BTIME',
  WMOVE = 'WMOVE',
  BMOVE = 'BMOVE',
}

type CommandTokens = [Command, ...string[]];

class Handler {
  private commands: {
    [key: string]: ((tokens: CommandTokens) => void) | undefined;
  };

  public game: ChessGame;

  constructor(game: ChessGame) {
    this.game = game;

    this.commands = {
      FEN: this.onFen.bind(this),
      WPLAYER: this.onPlayer.bind(this),
      BPLAYER: this.onPlayer.bind(this),
      WPV: this.onPV.bind(this),
      BPV: this.onPV.bind(this),
      WTIME: this.onTime.bind(this),
      BTIME: this.onTime.bind(this),
      WMOVE: this.onMove.bind(this),
      BMOVE: this.onMove.bind(this),
    };
  }

  private onFen(tokens: CommandTokens): void {
    const [, ...fenTokens] = tokens;
    const lastToken = fenTokens.slice(-1)[0];

    // Sometimes we don't get castling info
    if (lastToken == 'w' || lastToken == 'b')
      fenTokens.push('-');

    fenTokens.push('-', '0', '1');

    this.game.fen = fenTokens.join(' '); // build the fen

    if (!this.game.loaded)
      this.game.resetFromFen();

    logger.info(`Updated game ${this.game.name} - FEN: ${this.game.fen}`);
  }

  private onPlayer(tokens: CommandTokens): void {
    const [command, ...rest] = tokens;
    const name = rest.join(' ');

    if (command != Command.WPLAYER && command != Command.BPLAYER)
      return;

    const color: Color = (command == Command.WPLAYER) ? 'white' : 'black';

    if (this.game[color].name != name) {
      this.game.reset();
      this.game[color].name = name;
      logger.info(`Updated game ${this.game.name} - Color: ${color}, Name: ${this.game[color].name}`);
    }
  }

  private onPV(tokens: CommandTokens): void {
    const [command, ...rest] = tokens;

    if (command != Command.WPV && command != Command.BPV)
      return;

    const color: Color = (command == Command.WPV) ? 'white' : 'black';

    this.game[color].depth = parseInt(rest[0]);
    this.game[color].score = parseInt(rest[1]) / 100;
    this.game[color].nodes = parseInt(rest[3]);
    this.game[color].usedTime = parseInt(rest[2]) * 10;

    const copy = new Chess(this.game.instance.fen());
    const pv = rest.slice(4);
    const parsed: string[] = [];
    for (const alg of pv) {
      const move = copy.move(alg, { sloppy: true });
      if (!move) break;

      parsed.push(move.san);
    }

    // Only if we could parse at least 1 do
    if (parsed.length)
      this.game[color].pv = parsed;

    logger.info(`Updated game ${this.game.name} - Color: ${color}, Depth: ${this.game[color].depth}, Score: ${this.game[color].score}, Nodes: ${this.game[color].nodes}, UsedTime: ${this.game[color].usedTime}`);
    logger.debug(`Updated game ${this.game.name} - Color: ${color}, PV: ${this.game[color].pv.join(' ')}`);
  }

  private onTime(tokens: CommandTokens): void {
    const [command, ...rest] = tokens;

    if (command != Command.WTIME && command != Command.BTIME)
      return;

    const color: Color = (command == Command.WTIME) ? 'white' : 'black';
    this.game[color].clockTime = parseInt(rest[0]) * 10;

    logger.info(`Updated game ${this.game.name} - Color: ${color}, ClockTime: ${this.game[color].clockTime}`);
  }

  private onMove(tokens: CommandTokens) {
    const [command, ...rest] = tokens;

    if (command != Command.WMOVE && command != Command.BMOVE)
      return;

    const color: Color = (command == Command.WMOVE) ? 'white' : 'black';
    const notColor: Color = (command == Command.WMOVE) ? 'black' : 'white';

    this.game.moveNumber = parseInt(rest[0].replace('.', ''));

    const move = this.game.instance.move(rest[1]);
    if (move) {
      this.game[color].lastMove = move;
      logger.info(`Updated game ${this.game.name} - Color: ${color}, Last Move: ${this.game[color].lastMove?.san}`);
    } else {
      logger.warn(`Failed to parse ${rest[1]} for game ${this.game.name}! Loading from FEN...`);
      this.game.resetFromFen();
    }

    // start the timer for the other side
    this.game[notColor].startTime = new Date().getTime();
  }

  onMessage(buff: Buffer): string | null {
    let messageId: string | null = null;
    let str = buff.toString().trim();

    const idMatch = /^<\s*(\d+)>/g.exec(str);
    if (idMatch) {
      messageId = idMatch[1];
      logger.debug(`${messageId} parsed as Message Id for ${str}`);

      str = str.replace(/^<\s*(\d+)>/g, '');
    } else {
      logger.debug(`No Message Id found for ${str}`);
    }

    const tokens = str.split(/\s+/);
    if (tokens[0].endsWith(':'))
      tokens[0] = tokens[0].slice(0, -1);

    const command = this.commands[tokens[0]];

    if (command)
      command(tokens as CommandTokens);

    return messageId;
  }
}

export default Handler;
