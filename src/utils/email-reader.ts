import { ImapFlow } from 'imapflow';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface EmailMessage {
  subject: string;
  from: string;
  date: Date;
  text?: string;
  html?: string;
}

export class EmailReader {
  private client: ImapFlow;

  constructor(private config: EmailConfig) {
    this.client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.auth.user,
        pass: config.auth.pass
      },
      logger: false
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.logout();
  }

  async getVerifyLinksForFansly(since: Date): Promise<string[]> {
    await this.client.mailboxOpen('INBOX');
    const links = [];
    for await (const message of this.client.fetch({ seq: "1:*", since }, { envelope: true, bodyStructure: true, bodyParts: ["1"] })) {
      if (!message.envelope?.subject || !message.envelope.subject.includes("[Fansly]: Please verify your Email") || !message.bodyParts || !message.bodyParts.get("1"))
        continue;
      const content = Buffer.from(message.bodyParts.get("1")?.toString() || "", 'base64').toString('utf-8')
      const verifyLinkRegex = /https:\/\/fansly\.com\/emailverify\/[^\s]+/g;
      const verifyLink = content.match(verifyLinkRegex);
      if (verifyLink && verifyLink.length > 0)
        links.push(verifyLink[0])
    }
    return links;
  }

  async readEmails(mailbox: string = 'INBOX', limit: number = 10): Promise<void> {
    await this.client.mailboxOpen(mailbox);
    const messages = [];
    for await (const message of this.client.fetch("1:*", { envelope: true, bodyStructure: true, bodyParts: ["1"] })) {
      if (!message.envelope?.subject || !message.envelope.subject.includes("[Fansly]: Please verify your Email") || !message.bodyParts || !message.bodyParts.get("1"))
        continue;
      const content = Buffer.from(message.bodyParts.get("1")?.toString() || "", 'base64').toString('utf-8')
      const verifyLinkRegex = /https:\/\/fansly\.com\/emailverify\/[^\s]+/g;
      const verifyLink = content.match(verifyLinkRegex);
      if (verifyLink && verifyLink.length > 0)
        messages.push(verifyLink[0])
    }
    console.log(messages)
  }
}