import { CosmosClient } from "@azure/cosmos";
import chunk from "lodash/fp/chunk";
import dotenv from "dotenv"
dotenv.config();

type Tweet = {
    id: string;
    text: string;
}

type TimeLineResponse = {
    data: Tweet[];
    meta: {
        result_count: number,
        newest_id: number,
        oldest_id: number,
        next_token: string
    }
}

type UserInformation = {
    data: {
        id: string,
        name: string
        username: string
    }
}

type SentimentRequestBody = {
    documents: Tweet[]
}

type ConfidenceScores = {
    positive: number,
    neutral: number,
    negative: number,
}

type Sentiment = {
    id: string,
    sentiment: string,

    confidenceScores: ConfidenceScores,

    sentences: [{
        sentiment: string,
        confidenceScores: ConfidenceScores,
        offset: number,
        length: number,
        text: string
    }]
}

type SentimentResponseBody = {
    documents: Sentiment[]
}

type TweetWithSentiment = {
    id: string,
    text: string,
    type: string,

    sentiment: Sentiment
}

const cosmosClient = new CosmosClient({
    endpoint: process.env.COSMOS_DB_ENDPOINT || "",
    key: process.env.COSMOS_DB_KEY,
});

async function getUserInformation(): Promise<UserInformation> {
    console.log("Getting user information");
    const response = await fetch("https://api.twitter.com/2/users/by/username/devndive",
        { headers: {
                "Authorization": "Bearer " + process.env.TWITTER_BEARER_TOKEN
            }
        });

    const data = await response.json();
    console.log("User information: " + JSON.stringify(data));

    return data;
}

async function getHighestTweetId(): Promise<string | null> {
    console.log("Getting highest tweet id");
    const querySpec = {
        query: "SELECT t.id FROM tweets t WHERE t.type = @type ORDER BY t.id DESC OFFSET 0 LIMIT 1",
        parameters: [
            {
                name: "@type",
                value: "tweet"
            }
        ]
    };

    const response = await cosmosClient
        .database('mood')
        .container('tweets')
        .items.query(querySpec).fetchAll();

    if (response.resources.length > 0) {
        console.log("Highest tweet id: " + response.resources[0].id);
        return response.resources[0].id;
    }

    console.log("No tweets found");
    return null;
}

async function getAllTweetsByUser(userId: string, lastKnownTweetId: string | null): Promise<Tweet[]> {
    console.log("Getting tweets by userId: " + userId);

    let tweets: Tweet[] = [];
    let paginationToken = null;

    do  {
        const searchParams = new URLSearchParams();
        searchParams.append("max_results", "100");
        searchParams.append("exclude", "replies,retweets");

        if (lastKnownTweetId !== null) {
            searchParams.append("since_id", lastKnownTweetId);
        }

        if (paginationToken !== null) {
            searchParams.append("pagination_token", paginationToken);
        }

        const apiUrl = `https://api.twitter.com/2/users/${userId}/tweets?${searchParams.toString()}`;
        console.log("Fetching tweets from " + apiUrl);

        const response = await fetch(apiUrl, {
            headers: {
                "Authorization": "Bearer " + process.env.TWITTER_BEARER_TOKEN,
                "Content-Type": "application/json"
            }
        });

        const json: TimeLineResponse = await response.json();
        console.log(json);
        // tweets.concat(json.data);

        if (json.data) {
            tweets = [...tweets, ...json.data];
        }

        if (json.meta.next_token) {
            paginationToken = json.meta.next_token;
        } else {
            paginationToken = null;
        }
    } while (paginationToken !== null);

    return tweets;
}

async function main() {
    const hightestTweetId = await getHighestTweetId();

    // get twitter user information
    const userInformation = await getUserInformation();
    const tweets = await getAllTweetsByUser(userInformation.data.id, hightestTweetId);
    console.log("Number of tweets", tweets.length);

    const chunks = chunk(10, tweets);

    console.log("Chunks: " + chunks.length);
    for (let c of chunks) {
        const sentimentRequestBody: SentimentRequestBody = {
            documents: c
        };

        console.log("Getting sentiment for " + c.length + " tweets");
        const response = await fetch("https://mood-analyzer.cognitiveservices.azure.com/text/analytics/v3.2-preview.1/sentiment",
            {
                method: "POST",
                // @ts-ignore
                headers: {
                    "Ocp-Apim-Subscription-Key": process.env.COGNITIVE_SERVICE_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(sentimentRequestBody)
            });

        // console.log("Sentiment response: " + JSON.stringify(response));

        // @ts-ignore
        const sentimentResponseBody: SentimentResponseBody = await response.json();
        console.log("sentimentResponseBody:", sentimentResponseBody);

        for (let tweet of tweets) {

            for (let sentiment of sentimentResponseBody.documents) {
                if (tweet.id === sentiment.id) {
                    const tweetWithSentiment: TweetWithSentiment = {
                        id: sentiment.id,
                        text: tweet.text,
                        type: "tweet",
                        sentiment: sentiment
                    };

                    await cosmosClient
                        .database('mood')
                        .container('tweets')
                        .items.upsert(tweetWithSentiment);
                }
            }
        }
    }
}

main()
