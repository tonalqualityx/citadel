-- Designer portal W6.10: blast radius reaches the designer. The daemon posts a lib_index event after each preview deploy.

-- AlterEnum
ALTER TYPE "DesignEventKind" ADD VALUE 'lib_index';
