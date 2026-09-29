import { motion } from "motion/react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  containerVariants,
  riseVariants,
  SectionHeading,
  VIEWPORT,
} from "@/components/ui/motion-primitives";
import { FAQS } from "@/features/marketing/constants";

export const FaqSection = () => (
  <section id="faq" className="mx-auto max-w-3xl px-2 py-24">
    <SectionHeading eyebrow="FAQ" title="Good to know" />

    <Accordion type="single" collapsible className="w-full">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        whileInView="show"
        viewport={VIEWPORT}
      >
        {FAQS.map(({ q, a }, index) => (
          <motion.div key={q} variants={riseVariants}>
            <AccordionItem value={`item-${index}`} className="border-border">
              <AccordionTrigger className="text-left text-base font-medium transition-colors hover:text-foreground hover:no-underline">
                {q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-7 text-muted-foreground">
                {a}
              </AccordionContent>
            </AccordionItem>
          </motion.div>
        ))}
      </motion.div>
    </Accordion>
  </section>
);
