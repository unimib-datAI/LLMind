import { eq, and } from "drizzle-orm";
import { diagnosis, message } from "~/server/db/schema";
import { z } from "zod";
import {
  getFinishedDiagnosis,
  getInProgressDiagnosis,
  getNewDiagnosis,
} from "~/server/api/routers/block/queries";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const blockRouter = createTRPCRouter({
  getBlocks: publicProcedure
    .input(
      z.object({
        userToken: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // get validated diagnosis
      const validated = await getFinishedDiagnosis(ctx.db, input.userToken);
      // get in-progress diagnosis
      const inProgress = await getInProgressDiagnosis(ctx.db, input.userToken);
      if (inProgress == undefined) {
        const newBlock = await getNewDiagnosis(ctx.db, input.userToken);
        return {
          validated: validated,
          current: newBlock,
        };
      }
      return {
        validated: validated,
        current: inProgress,
      };
    }),
  updateBlock: publicProcedure
    .input(
      z.object({
        userToken: z.number(),
        blockId: z.number(),
        messageId: z.number(),
        currentblockOperation: z.enum([
          "VALIDATION",
          "SCORE",
          "NOTE",
          "FINISHED",
        ]),
        response: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      switch (input.currentblockOperation) {
        case "VALIDATION": {
          const validationResponse =
            input.response == "Yes" ? "CORRECT" : "INCORRECT";
          await ctx.db
            .update(diagnosis)
            .set({ currentOperation: "SCORE", validation: validationResponse })
            .where(
              and(
                eq(diagnosis.userId, input.userToken),
                eq(diagnosis.id, input.blockId),
              ),
            );
          await ctx.db
            .update(message)
            .set({ hasValidation: false })
            .where(eq(message.id, input.messageId));
          await ctx.db.insert(message).values([
            {
              hasValidation: false,
              messageType: "DEFAULT",
              role: "USER",
              text: `The answer has been validated as ${validationResponse}`,
              timestamp: new Date(),
              orderNumber: 3,
              diagnosisBlock: input.blockId,
              hasSkip: false,
            },
            {
              hasValidation: false,
              messageType: "DEFAULT",
              role: "AI",
              text: "Validate the answer with a score from 0 to 1 ",
              timestamp: new Date(),
              orderNumber: 4,
              diagnosisBlock: input.blockId,
              hasSkip: false,
            },
          ]);
          break;
        }
        case "NOTE": {
          await ctx.db
            .update(diagnosis)
            .set({ currentOperation: "FINISHED", score: input.response })
            .where(
              and(
                eq(diagnosis.userId, input.userToken),
                eq(diagnosis.id, input.blockId),
              ),
            );
          if (input.response != "Skip") {
            await ctx.db.insert(message).values({
              hasValidation: false,
              messageType: "DEFAULT",
              role: "USER",
              text: input.response,
              timestamp: new Date(),
              orderNumber: 7,
              diagnosisBlock: input.blockId,
              hasSkip: false,
            });
          }
          await ctx.db
            .update(message)
            .set({ hasSkip: false, hasValidation: false })
            .where(and(eq(message.diagnosisBlock, input.blockId)));
          break;
        }
        case "SCORE": {
          await ctx.db
            .update(diagnosis)
            .set({ currentOperation: "NOTE", score: input.response })
            .where(
              and(
                eq(diagnosis.userId, input.userToken),
                eq(diagnosis.id, input.blockId),
              ),
            );
          await ctx.db.insert(message).values([
            {
              hasValidation: false,
              messageType: "DEFAULT",
              role: "USER",
              text: input.response,
              timestamp: new Date(),
              orderNumber: 5,
              diagnosisBlock: input.blockId,
              hasSkip: false,
            },
            {
              hasValidation: false,
              messageType: "DEFAULT",
              role: "AI",
              text: "Would you like to add any additional notes?",
              timestamp: new Date(),
              orderNumber: 6,
              diagnosisBlock: input.blockId,
              hasSkip: true,
            },
          ]);
          break;
        }
        default: {
          break;
        }
      }
    }),
});
