import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

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

export const FaqSection = () => {
  const { t } = useTranslation();
  return (
    <section id="faq" className="mx-auto max-w-3xl px-2 py-24">
      <SectionHeading eyebrow={t("marketing.faq.eyebrow")} title={t("marketing.faq.title")} />

      <Accordion type="single" collapsible className="w-full">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={VIEWPORT}
        >
          {FAQS.map((key) => (
            <motion.div key={key} variants={riseVariants}>
              <AccordionItem value={key} className="border-border">
                <AccordionTrigger className="text-start text-base font-medium transition-colors hover:text-foreground hover:no-underline">
                  {t(`marketing.faq.items.${key}.q`)}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-7 text-muted-foreground">
                  {t(`marketing.faq.items.${key}.a`)}
                </AccordionContent>
              </AccordionItem>
            </motion.div>
          ))}
        </motion.div>
      </Accordion>
    </section>
  );
};
