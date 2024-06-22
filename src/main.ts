import {
  Client,
  Collection,
  Message,
  MessageCreateOptions,
  MessagePayload,
  TextChannel,
  ThreadChannel,
} from "discord.js";
import { main } from "../package/kotone/src/function-calling";
import "dotenv/config";
import { ChatCompletionMessageParam } from "openai/src/resources/index.js";

type DiscordMessage = {
  author: string;
  content: string;
  timestamp?: number;
};

async function callGenerativeAi(
  thread: DiscordMessage[],
  callback: { (_: any): Promise<Message<true>>; (options: string | MessagePayload | MessageCreateOptions): Promise<Message<true>>; (arg0: string): any; }
) {
  const messages = thread.map((message) => {
    return {
      content: message.content,
      role: client.user?.id === message.author ? "assistant" : "user",
      name: client.user?.id ?? "",
    } as ChatCompletionMessageParam;
  });
  let response = "";

  try {
    const generator = main(messages);
    for await (const message of generator) {
      switch (message.type) {
        case "chunk":
          response += message.value;
          break;
        case "guide":
          await callback(message.value || 'Message is Empty');
          break;
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    return response;
  }
}

const kotoneThreads = new Collection<string, Date>();

const client = new Client({
  intents: ["Guilds", "GuildMessages", "MessageContent"],
});

client.on("ready", () => {
  console.log(`Logged in as ${client.user?.tag}!`);
});

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;

  const isKotoneMention = message.mentions.has(client.user!);
  const isInKotoneThread =
    message.channel.isThread() && kotoneThreads.has(message.channel.id);

  if (!isKotoneMention && !isInKotoneThread) return;
  if (message.content.startsWith('!')) return;

  let replyThread: ThreadChannel;

  if (message.channel.isThread()) {
    replyThread = message.channel as ThreadChannel;
  } else {
    replyThread = await (message.channel as TextChannel).threads.create({
      name: `Discussion with ${message.author.username}`,
      autoArchiveDuration: 60,
      startMessage: message,
    });

    kotoneThreads.set(replyThread.id, new Date());

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    kotoneThreads.sweep((creationTime) => creationTime < oneDayAgo);
  }

  replyThread.sendTyping();
  const response = await generateResponse(
    replyThread,
    message,
    (_: string | MessagePayload | MessageCreateOptions) => replyThread.send(_)
  );
  if (response) await replyThread.send(response);

  if (shouldSendImage(message.content)) {
    await sendImage(replyThread);
  }
});

async function generateResponse(
  thread: ThreadChannel,
  latestMessage: Message,
  callback: { (_: any): Promise<Message<true>>; (options: string | MessagePayload | MessageCreateOptions): Promise<Message<true>>; }
): Promise<string> {
  const messages = await thread.messages.fetch({ limit: 100 });
  const conversationHistory: DiscordMessage[] = messages
    .reverse()
    .map((msg) => ({
      content: msg.content,
      author: msg.author.id,
      timestamp: msg.createdTimestamp,
    }))
    .filter((msg) => ( !msg.content.startsWith('!')));

  // Add the latest message if it's not already in the thread
  if (!messages.has(latestMessage.id)) {
    conversationHistory.push({
      content: latestMessage.content,
      author: latestMessage.author.id,
      timestamp: latestMessage.createdTimestamp,
    });
  }

  try {
    const response = await callGenerativeAi(conversationHistory, callback);
    return response;
  } catch (error) {
    console.error("Error calling generative AI:", error);
    return "申し訳ありません。応答の生成中にエラーが発生しました。";
  }
}

function shouldSendImage(content: string): boolean {
  // Implement your image sending condition here
  return content.toLowerCase().includes("image");
}

async function sendImage(channel: ThreadChannel | TextChannel) {
  // Implement your image sending logic here
  await channel.send("Here is an image: [image URL]");
}

client.login(process.env.DISCORD_BOT_TOKEN);
